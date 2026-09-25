// Тема до первой отрисовки: обычный (не module) скрипт в <head> — модули откладываются, и страница успевает мигнуть светлым.
try { var t = localStorage.getItem("fba_theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) {}
