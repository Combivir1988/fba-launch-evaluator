# Формат документов экспорта

## Один анализ — `FBA_<niche-slug>_<YYYY-MM-DD>.json`

```json
{ "type": "fba-launch-evaluator/analysis", "schemaVersion": 1, "exportedAt": "...", "analysis": { /* Analysis, см. data-model.md */ } }
```

## История — `FBA_history_<YYYY-MM-DD>.json`

```json
{ "type": "fba-launch-evaluator/history", "schemaVersion": 1, "exportedAt": "...", "analyses": [ /* Analysis[] */ ] }
```

Импорт принимает оба типа; при `schemaVersion` < текущей выполняется `migrate()`, при > текущей — отказ с сообщением «файл из более новой версии».

## Автономный дашборд — `FBA_<niche-slug>_<YYYY-MM-DD>.html`

Один файл: `<style>` (копия `public/css/app.css`), `<script>` Chart.js UMD, `<script>` `render.js`, `<script id="fba-data" type="application/json">` с документом Analysis, вызов `FBARender.render(document.getElementById('app'), data, {static: true})`. Внешних запросов нет; тема — по `prefers-color-scheme` + переключатель.
