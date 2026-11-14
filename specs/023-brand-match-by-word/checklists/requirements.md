# Specification Quality Checklist: Брендовые запросы — отличать бренд от куска слова

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Все пункты пройдены.** Отдельно отмечено три решения, принятые при проверке:

1. **Ни одного маркера [NEEDS CLARIFICATION].** Два места выглядели как требующие вопроса, но оба разрешены прецедентом и записаны в «Assumptions», а не вынесены вопросом:
   - что делать с уже сохранёнными кластерами — решено по прецеденту раздела «Статистика» (расхождение показываем, сохранённые разборы не трогаем), это US3;
   - какое именно правило смысловой близости взять — спека намеренно **не задаёт формулу**, а требует, чтобы планка была одна и чтобы выбор был сделан замером с названными потерями (FR-012, FR-013). Задавать формулу в спеке означало бы выбрать её вкусом, а не замером.

2. **«Контрольный отпечаток результатов» в SC-005 — проектный словарь приёмки, а не деталь реализации.** Он употребляется в этом же значении в спеках 019, 020 и 022 и является тем, чем господарь проверяет «лишнее не тронуто». Заменять его описательной формулировкой означало бы сделать ворота непроверяемыми.

3. **Все числа ожиданий взяты из замера 14 ноября 2026** по 69 живым анализам (67 с выгрузкой ключей), снятого чтением живой базы без единой записи. Существенное расхождение с ожиданием при выполнении — повод остановиться и разобраться, а не поправить ожидание.
