import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, dummyVerify, validateNewPassword, _stats } from "../server/passwords.js";

test("hash → verify: верный и неверный пароль, формат с параметрами", async () => {
  const h = await hashPassword("correct horse battery");
  assert.match(h, /^scrypt\$15\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("correct horse batterY", h), false);
  assert.equal(await verifyPassword("", h), false);
});

test("соль случайная: одинаковые пароли дают разные хэши", async () => {
  const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password-1", a), true);
  assert.equal(await verifyPassword("same-password-1", b), true);
});

test("битая или чужая строка хэша → false, без исключения", async () => {
  for (const bad of ["", "x", null, undefined, "scrypt$15$8$3$$", "scrypt$99$8$3$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA", "bcrypt$2b$10$abc"]) {
    assert.equal(await verifyPassword("whatever-pass", bad), false, String(bad));
  }
  assert.equal(await dummyVerify(), false);
});

test("очередь: параллельные вызовы выполняются по одному", async () => {
  await Promise.all([hashPassword("p-aaaaaaaaaa"), hashPassword("p-bbbbbbbbbb"), dummyVerify(), hashPassword("p-cccccccccc")]);
  assert.equal(_stats().peak, 1);
});

test("unicode нормализуется (NFKC)", async () => {
  const h = await hashPassword("пароль-é-12345");
  assert.equal(await verifyPassword("пароль-é-12345", h), true);
});

test("validateNewPassword", () => {
  assert.match(validateNewPassword("short"), /не короче 10/);
  assert.match(validateNewPassword("same-password", "same-password"), /отличаться/);
  assert.match(validateNewPassword("x".repeat(201)), /слишком длинный/);
  assert.equal(validateNewPassword("long-enough-pass", "other-password"), null);
  assert.match(validateNewPassword(12345678901), /не короче/);
});
