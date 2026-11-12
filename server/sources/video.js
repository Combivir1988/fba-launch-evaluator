// Spec 021 — источник «видео»: страница поиска по теме раздела.
//
// ДВА параметра запроса обязательны, и оба поставлены по ЗАМЕРУ, а не по вкусу:
//
// 1. ЯЗЫК И РЕГИОН (D8). Без них площадка выбирает язык по адресу, с которого пришёл запрос.
//    Замер 2026-11-12: с польского адреса пришли «2 lata temu» и «wyświetleń», и разборщик
//    под английский записал бы «нет данных» — честно по форме, неверно по сути.
//
// 2. ФИЛЬТР ПО ДАТЕ. Замер того же дня: в выдаче по умолчанию возраст всех семнадцати роликов —
//    от года до одиннадцати лет, внутри окна сопоставимости НОЛЬ. Упорядочивание по дате выдачу
//    не переупорядочило. Без фильтра minSample не набрался бы никогда, и источник был бы мёртв
//    навсегда — выглядя при этом исправным.
import { parseVideoSearch } from "../../shared/idea-parse.js";

const BASE = "https://www.youtube.com/results";
/** Фильтр «за этот месяц». Вся выборка попадает внутрь compareWindowDays = 90. */
export const MONTH_FILTER = "EgQIBBAB";

export const buildUrl = (handle, { sp = MONTH_FILTER } = {}) =>
  `${BASE}?search_query=${encodeURIComponent(handle)}&hl=en&gl=US&sp=${sp}`;

/** Заголовок языка дублирует параметр адреса намеренно: площадка смотрит на оба. */
export const headers = () => ({ "accept-language": "en-US,en;q=0.9" });

/** Данные страницы встроены в неё целиком — отдельного запроса к ним не нужно. */
export function extractData(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(String(html ?? ""));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function parse(html, { now = Date.now() } = {}) {
  const data = extractData(html);
  if (!data) return { items: [], dropped: 0, failCode: "unparsed", failMessage: "В ответе нет встроенных данных страницы — похоже, разметка площадки изменилась" };
  return parseVideoSearch(data, { now });
}

export const platform = "video";
/** Запрос нёс фильтр по дате — значит выборка почти без свежего означает, что фильтр не применился. */
export const expectsFresh = true;
export const requireGoalRatio = false;
export const needsBypass = false;
