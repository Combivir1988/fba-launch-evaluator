// Spec 021 — источник «канал мессенджера»: превью публичного канала.
//
// Дата здесь АБСОЛЮТНАЯ (ISO с зоной), поэтому ловушки с языком (D8) нет и закреплять язык незачем.
//
// ОГРАНИЧЕНИЕ, которое обязано быть сказано человеку (FR-010, SC-012): поиска по площадке
// не существует. Радар видит только названные каналы — и ничего больше.
import { parseChannelPreview } from "../../shared/idea-parse.js";

/** Область здесь НЕ ПРИМЕНИМА: у площадки нет ни поиска, ни разделения по странам —
 *  человек называет канал сам. Рынок у такого раздела только подписывает его в списке. */
export const hasMarket = false;
export const buildUrl = (handle) => "https://t.me/s/" + encodeURIComponent(String(handle).replace(/^@/, ""));

export const headers = () => ({});

export const parse = (html, { now = Date.now() } = {}) => parseChannelPreview(html, { now });

export const platform = "channel";
// Фильтра по дате у площадки нет: приходят последние посты, какого бы возраста они ни были.
// Поэтому тихий канал — это «фона не из чего посчитать», а не «фильтр не применился».
export const expectsFresh = false;
export const requireGoalRatio = false;
export const needsBypass = false;
