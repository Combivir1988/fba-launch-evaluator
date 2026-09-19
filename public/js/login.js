// Страница входа и принудительной смены временного пароля (spec 002, US1).
import { api } from "/js/api.js";

const $ = (s) => document.querySelector(s);
const saved = localStorage.getItem("fba_theme"); if (saved) document.documentElement.setAttribute("data-theme", saved);

/** Возврат только на свой же сайт: ?next=/… (защита от открытого редиректа). */
function nextUrl() {
  const n = new URLSearchParams(location.search).get("next") || "/";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login.html") ? n : "/";
}
const show = (el, text) => { el.textContent = text; el.classList.toggle("hidden", !text); };
function mode(name, user) {
  $("#login-form").classList.toggle("hidden", name !== "login");
  $("#change-form").classList.toggle("hidden", name !== "change");
  if (name === "change") { $("#change-user").value = user?.login || ""; $("#change-hello").textContent = `${user?.name || ""}, пароль, выданный администратором, временный. Задайте свой — не короче 10 символов.`; $("#change-current").focus(); }
  else $("#login-name").focus();
}

async function init() {
  try {
    const me = await api("GET", "/api/auth/me", undefined, { noRedirect: true });
    if (me.mustChangePassword) return mode("change", me.user);
    location.replace(nextUrl());
  } catch { mode("login"); }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault(); show($("#login-msg"), ""); $("#login-btn").disabled = true;
  try {
    const me = await api("POST", "/api/auth/login", { login: $("#login-name").value, password: $("#login-pass").value }, { noRedirect: true });
    if (me.mustChangePassword) { $("#change-current").value = $("#login-pass").value; mode("change", me.user); $("#change-next").focus(); }
    else location.replace(nextUrl());
  } catch (err) {
    const wait = err.retryAfter ? ` Повторите через ${Math.ceil(err.retryAfter / 60)} мин.` : "";
    show($("#login-msg"), (err.code === "locked" || err.code === "rate_limited" ? err.message + "." + wait : err.message) || "Не удалось войти");
    $("#login-pass").value = ""; $("#login-pass").focus();
  } finally { $("#login-btn").disabled = false; }
});

$("#change-form").addEventListener("submit", async (e) => {
  e.preventDefault(); show($("#change-msg"), "");
  const next = $("#change-next").value;
  if (next !== $("#change-next2").value) return show($("#change-msg"), "Новые пароли не совпадают");
  $("#change-btn").disabled = true;
  try { await api("POST", "/api/auth/password", { current: $("#change-current").value, next }, { noRedirect: true }); location.replace(nextUrl()); }
  catch (err) { show($("#change-msg"), err.message || "Не удалось сменить пароль"); }
  finally { $("#change-btn").disabled = false; }
});
$("#change-logout").addEventListener("click", async () => { try { await api("POST", "/api/auth/logout", undefined, { noRedirect: true }); } catch {} mode("login"); });

init();
