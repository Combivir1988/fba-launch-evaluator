# Tasks: промо на листингах (spec 014)

- [x] T001 `server/promo-parse.js` (`parsePromo`, `effectivePrice`), фикстура реальной страницы, синтетические блоки купона/дила/S&S; `tests/promo.test.js`
- [x] T002 `server/scrapfly.js`: `html` в `normalizeProduct` → `listing.promo`; MOCK-промо; `cost_budget` 80
- [x] T003 `shared/promo-stats.js` → `results.config.promo`; чеклист «Купоны/дилы» авто; AI-пейлоад; `stripNew`
- [x] T004 Интерфейс: карточки «Промо в нише», столбец «Промо», подсказки, справка
- [x] T005 Регрессия, коммит, push, деплой при `health.running = 0`, память и внешний CLAUDE.md

## Выпуск

- 2026-09-23: на проде. `parsePromo` разбирает List Price / −N % / купон / дил / Subscribe & Save / акции только внутри блоков цены и акций (проверено: реальная страница B00UOXMCBI → $125.99, −15 %, $106.99; страницы без промо → null, без ложных срабатываний на навигацию — грубый поиск по всей странице давал ложный List Price из соседнего виджета). `listing.promo` из HTML того же ответа — кредиты не растут; `cost_budget` 80. `results.config.promo`, карточки «Промо в нише», столбец «Промо», чеклист «Купоны/дилы» авто. Старый кэш промо не содержит (пометка «—»). Тесты promo (6), проба ui-probe17.
