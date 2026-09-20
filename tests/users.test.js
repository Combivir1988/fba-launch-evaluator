import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/db.js";
import { createSessions } from "../server/sessions.js";
import { createUsers, UserError, MAX_FAILED, LOCK_MS } from "../server/users.js";

let db, clock, S, U, dummyCalls;
// Быстрый хэшер для логики; настоящий scrypt проверяется в passwords.test.js и в одном тесте ниже.
const fake = { hashPassword: async (p) => "fake:" + p, verifyPassword: async (p, h) => h === "fake:" + p, dummyVerify: async () => { dummyCalls++; return false; } };
const code = (c) => (e) => e instanceof UserError && e.code === c;

before(async () => { db = await testDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.reset(); clock = Date.parse("2026-09-19T10:00:00Z"); dummyCalls = 0; S = createSessions(db, { now: () => clock }); U = createUsers(db, S, { hasher: fake, now: () => clock }); });

test("createUser: нормализация логина, временный пароль, занятый логин, проверки полей", async () => {
  const u = await U.createUser({ login: "  Anna.K ", name: " Анна ", password: "temp-password-1" });
  assert.equal(u.login, "anna.k"); assert.equal(u.name, "Анна"); assert.equal(u.role, "user"); assert.equal(u.mustChangePassword, true);
  assert.equal("password_hash" in u, false);
  await assert.rejects(U.createUser({ login: "ANNA.k", name: "Дубль", password: "temp-password-1" }), code("login_taken"));
  await assert.rejects(U.createUser({ login: "ab", name: "X", password: "temp-password-1" }), code("bad_login"));
  await assert.rejects(U.createUser({ login: "юзер", name: "X", password: "temp-password-1" }), code("bad_login"));
  await assert.rejects(U.createUser({ login: "okname", name: "", password: "temp-password-1" }), code("bad_name"));
  await assert.rejects(U.createUser({ login: "okname", name: "X", role: "root", password: "temp-password-1" }), code("bad_role"));
  await assert.rejects(U.createUser({ login: "okname", name: "X", password: "short" }), code("bad_password"));
});

test("authenticate: успех, неверный пароль, неизвестный и отключённый логин выглядят одинаково", async () => {
  const u = await U.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const ok = await U.authenticate("ANNA", "temp-password-1");
  assert.equal(ok.id, u.id); assert.ok(ok.lastLoginAt);
  const errs = [];
  for (const [l, p] of [["anna", "wrong-password"], ["ghost", "temp-password-1"], ["", "x"], ["anna", 12345]]) await U.authenticate(l, p).catch((e) => errs.push([e.code, e.message, e.status]));
  await U.updateUser(u.id, { active: false }).catch(() => {}); // единственный не-админ → можно отключить
  await U.authenticate("anna", "temp-password-1").catch((e) => errs.push([e.code, e.message, e.status]));
  assert.equal(errs.length, 5);
  for (const e of errs) assert.deepEqual(e, ["invalid_credentials", "Неверный логин или пароль", 401]);
  assert.ok(dummyCalls >= 3, "для неизвестного логина выполняется фиктивная проверка");
});

test("блокировка после 5 неудач на 15 минут; успех сбрасывает счётчик; неизвестный логин блокируется так же", async () => {
  await U.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  for (let i = 0; i < MAX_FAILED - 1; i++) await assert.rejects(U.authenticate("anna", "bad-password-x"), code("invalid_credentials"));
  await U.authenticate("anna", "temp-password-1"); // сброс
  for (let i = 0; i < MAX_FAILED; i++) await assert.rejects(U.authenticate("anna", "bad-password-x"), code("invalid_credentials"));
  const e = await U.authenticate("anna", "temp-password-1").catch((x) => x);
  assert.equal(e.code, "locked"); assert.equal(e.status, 429); assert.equal(e.retryAfter, LOCK_MS / 1000);
  clock += LOCK_MS + 1000;
  assert.ok(await U.authenticate("anna", "temp-password-1"));
  for (let i = 0; i < MAX_FAILED; i++) await assert.rejects(U.authenticate("ghost", "bad-password-x"), code("invalid_credentials"));
  await assert.rejects(U.authenticate("ghost", "bad-password-x"), code("locked"));
});

test("updateUser: нельзя оставить систему без активного администратора", async () => {
  const a = await U.createUser({ login: "admin1", name: "Админ", role: "admin", password: "temp-password-1" });
  await assert.rejects(U.updateUser(a.id, { active: false }), code("last_admin"));
  await assert.rejects(U.updateUser(a.id, { role: "user" }), code("last_admin"));
  const b = await U.createUser({ login: "admin2", name: "Второй", role: "admin", password: "temp-password-1" });
  assert.equal((await U.updateUser(a.id, { role: "user" })).role, "user");
  await assert.rejects(U.updateUser(b.id, { active: false }), code("last_admin"));
  assert.equal((await U.updateUser(b.id, { name: "Новое имя" })).name, "Новое имя");
  await assert.rejects(U.updateUser("00000000-0000-4000-8000-000000000000", { name: "X" }), code("not_found"));
});

test("отключение и сброс пароля закрывают сеансы; сброс снимает блокировку и требует смены", async () => {
  const u = await U.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const t1 = await S.createSession(u.id); assert.ok(await S.resolveSession(t1));
  await U.updateUser(u.id, { active: false });
  assert.equal(await S.resolveSession(t1), null);
  await U.updateUser(u.id, { active: true });
  const t2 = await S.createSession(u.id); await S.resolveSession(t2);
  await db.query("UPDATE users SET locked_until = $2, must_change_password = false WHERE id = $1", [u.id, new Date(clock + LOCK_MS)]);
  await U.resetPassword(u.id, "brand-new-temp-1");
  assert.equal(await S.resolveSession(t2), null);
  const again = await U.authenticate("anna", "brand-new-temp-1");
  assert.equal(again.mustChangePassword, true);
  await assert.rejects(U.resetPassword(u.id, "short"), code("bad_password"));
});

test("changePassword: проверка текущего, правила нового, закрытие остальных сеансов", async () => {
  const u = await U.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  const keep = await S.createSession(u.id), other = await S.createSession(u.id);
  await assert.rejects(U.changePassword(u.id, "wrong-current", "new-password-22"), code("wrong_password"));
  await assert.rejects(U.changePassword(u.id, "temp-password-1", "temp-password-1"), code("bad_password"));
  await assert.rejects(U.changePassword(u.id, "temp-password-1", "short"), code("bad_password"));
  await U.changePassword(u.id, "temp-password-1", "new-password-22", keep);
  assert.equal((await S.resolveSession(keep)).user.mustChangePassword, false);
  assert.equal(await S.resolveSession(other), null);
  assert.ok(await U.authenticate("anna", "new-password-22"));
});

test("updateSettings: только известные ключи, слияние", async () => {
  const u = await U.createUser({ login: "anna", name: "Анна", password: "temp-password-1" });
  assert.deepEqual(await U.updateSettings(u.id, { modelAi: "a/b", evil: "x" }), { modelAi: "a/b" });
  assert.deepEqual(await U.updateSettings(u.id, { modelPatents: "c/d" }), { modelAi: "a/b", modelPatents: "c/d" });
  await assert.rejects(U.updateSettings(u.id, { modelAi: 5 }), code("bad_settings"));
});

test("bootstrapAdmin: создаёт один раз, не трогает существующего, восстанавливает доступ", async () => {
  assert.deepEqual(await U.bootstrapAdmin({}), { created: false, reason: "no_env" });
  assert.deepEqual(await U.bootstrapAdmin({ adminLogin: "Owner", adminPassword: "owner-password-1" }), { created: true, restored: false, login: "owner" });
  assert.deepEqual(await U.bootstrapAdmin({ adminLogin: "owner", adminPassword: "another-password" }), { created: false, reason: "exists" });
  await assert.rejects(U.authenticate("owner", "another-password"), code("invalid_credentials"));
  await db.query("UPDATE users SET active = false"); // владелец потерял доступ
  assert.deepEqual(await U.bootstrapAdmin({ adminLogin: "owner", adminPassword: "restored-password-1" }), { created: true, restored: true, login: "owner" });
  const me = await U.authenticate("owner", "restored-password-1");
  assert.equal(me.role, "admin"); assert.equal(me.mustChangePassword, true);
});

test("listUsers / listNames; настоящий scrypt end-to-end", async () => {
  const real = createUsers(db, S, { now: () => clock });
  const u = await real.createUser({ login: "real", name: "Реальный", password: "real-password-123" });
  assert.match((await db.query("SELECT password_hash FROM users WHERE id = $1", [u.id])).rows[0].password_hash, /^scrypt\$15\$8\$3\$/);
  assert.equal((await real.authenticate("real", "real-password-123")).id, u.id);
  await assert.rejects(real.authenticate("real", "real-password-124"), code("invalid_credentials"));
  const list = await U.listUsers();
  assert.equal(list.length, 1); assert.equal(list[0].analyses, 0); assert.equal("password_hash" in list[0], false);
  assert.deepEqual(await U.listNames(), [{ id: u.id, name: "Реальный" }]);
});

// ---------- spec 004: приглашение по почте и вход через Google ----------
test("приглашение по почте: без пароля, логин из почты, вход по паролю невозможен", async () => {
  const u = await U.createUser({ email: "  Anna.Koval@Gmail.com ", role: "user" });
  assert.equal(u.email, "anna.koval@gmail.com"); assert.equal(u.login, "anna.koval"); assert.equal(u.name, "anna.koval"); assert.equal(u.hasPassword, false); assert.equal(u.googleLinked, false); assert.equal(u.mustChangePassword, false);
  const second = await U.createUser({ email: "anna.koval@ukr.net", name: "Анна Вторая" }); assert.equal(second.login, "anna.koval2", "логин занят — добавляется суффикс");
  assert.equal((await U.createUser({ email: "я@пример.укр", name: "Кириллица" })).login, "user", "недопустимые символы убираются, короткий логин дополняется");
  await assert.rejects(U.createUser({ email: "ANNA.KOVAL@gmail.com", name: "Дубль" }), code("email_taken"));
  await assert.rejects(U.createUser({ name: "Никто" }), code("bad_password"));
  await assert.rejects(U.createUser({ email: "not-an-email", name: "X" }), code("bad_email"));
  for (const pw of ["!", "", "anything-at-all"]) await assert.rejects(U.authenticate("anna.koval", pw), code("invalid_credentials"));
  await assert.rejects(U.changePassword(u.id, "x", "new-password-123"), code("no_password"));
});

test("findForGoogle: привязка при первом входе, затем опознание по sub; имя из Google; отказы неразличимы", async () => {
  const u = await U.createUser({ email: "anna@gmail.com" });
  const first = await U.findForGoogle({ sub: "g-111", email: "Anna@Gmail.com", name: "Анна Коваль" });
  assert.equal(first.id, u.id); assert.equal(first.googleLinked, true); assert.equal(first.name, "Анна Коваль", "авто-имя заменено именем из Google"); assert.ok(first.lastLoginAt);
  const renamed = await U.findForGoogle({ sub: "g-111", email: "anna.new@gmail.com", name: "Другое имя" });
  assert.equal(renamed.id, u.id, "почта в Google сменилась — опознаём по sub"); assert.equal(renamed.name, "Анна Коваль", "имя больше не перезаписывается");
  const named = await U.createUser({ email: "ivan@gmail.com", name: "Иван (закупки)" });
  assert.equal((await U.findForGoogle({ sub: "g-222", email: "ivan@gmail.com", name: "Ivan Petrov" })).name, "Иван (закупки)", "имя, заданное администратором, сохраняется");
  const errs = [];
  for (const who of [{ sub: "g-999", email: "stranger@gmail.com" }, { sub: "g-333", email: "anna@gmail.com" }, { sub: "", email: "anna@gmail.com" }, { sub: "g-444", email: "" }]) await U.findForGoogle(who).catch((e) => errs.push([e.code, e.status, e.message]));
  await U.updateUser(named.id, { active: false }); await U.findForGoogle({ sub: "g-222", email: "ivan@gmail.com" }).catch((e) => errs.push([e.code, e.status, e.message]));
  assert.equal(errs.length, 5); for (const e of errs) assert.deepEqual(e, ["google_not_invited", 403, "Этой почты нет в списке приглашённых"]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 2, "учётные записи для чужих почт не создаются");
});

test("почта у пользователя с паролем: оба способа входа; смена и снятие почты", async () => {
  const u = await U.createUser({ login: "petro", name: "Петро", password: "temp-password-1" });
  assert.equal(u.hasPassword, true); assert.equal(u.email, null);
  const withMail = await U.updateUser(u.id, { email: "Petro@Example.com" }); assert.equal(withMail.email, "petro@example.com");
  assert.equal((await U.findForGoogle({ sub: "g-p", email: "petro@example.com" })).id, u.id); assert.ok(await U.authenticate("petro", "temp-password-1"));
  const other = await U.createUser({ email: "olga@example.com" });
  await assert.rejects(U.updateUser(other.id, { email: "petro@example.com" }), code("email_taken"));
  await assert.rejects(U.updateUser(other.id, { email: "" }), code("email_required"));
  assert.equal((await U.updateUser(u.id, { email: "" })).email, null, "у пользователя с паролем почту можно снять");
  const list = await U.listUsers(); assert.ok(list.every((x) => "hasPassword" in x && "email" in x && !("password_hash" in x) && !("google_sub" in x)));
});
