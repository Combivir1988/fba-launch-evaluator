// Spec 021 — источник «краудфандинг»: лента категории в машиночитаемом виде.
//
// ВСЕГДА через обход защиты: прямой запрос отклонён замером (403, страница проверки браузера).
// При этом НЕ самый дорогой из трёх — замер 2026-11-12 дал 1 кредит.
//
// Отбор по ПОПУЛЯРНОСТИ среди идущих сейчас, а НЕ по новизне. Замер: у самых новых проектов
// из двенадцати шесть собрали ровно ноль. Это «ещё слишком рано», а не «никому не интересно»,
// и фон такой выборки вырождается.
import { parseCrowdfundingFeed } from "../../shared/idea-parse.js";

const BASE = "https://www.kickstarter.com/discover/advanced";

/** Область площадки. ЗАМЕР 2026-11-12, и здесь она РАБОТАЕТ, в отличие от видео:
 *  без фильтра 398 проектов (US, GB, HK вперемешку), США 183, Европа 100;
 *  пересечение с общей лентой — 5 и 2 из двенадцати. Это РАЗНЫЕ пулы, а не оттенки одного. */
export const WOE = { US: "23424977", EU: "24865675" };

export const buildUrl = (handle, { market = "US" } = {}) =>
  `${BASE}?category_id=${encodeURIComponent(handle)}&sort=popularity&state=live&woe_id=${WOE[market] ?? WOE.US}&format=json`;

export const headers = () => ({ accept: "application/json" });

export function parse(body, { now = Date.now() } = {}) {
  let data = body;
  if (typeof body === "string") {
    try { data = JSON.parse(body); }
    catch { return { items: [], dropped: 0, failCode: "unparsed", failMessage: "Ответ не разобрался как лента проектов — похоже, вместо неё пришла страница проверки браузера" }; }
  }
  return parseCrowdfundingFeed(data, { now });
}

export const platform = "crowdfunding";
export const expectsFresh = false;
/** Второе условие: доля от цели. Скорость сбора к возрасту приводится, доля от цели — нет. */
export const requireGoalRatio = true;
export const needsBypass = true;
