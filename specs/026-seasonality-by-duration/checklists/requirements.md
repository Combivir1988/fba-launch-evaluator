# Specification Quality Checklist: Сезонность по длительности, а не по крайностям

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-17
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

**Проверка пройдена с первого прохода.** Отдельно сверено:

- **Имена файлов и строк кода в спеку не попали.** Связи описаны по существу («статус входит в сводную оценку, сводная оценка влияет на вердикт»), а не по именам модулей — конкретные места назовёт план.
- **Все пороги помечены как подлежащие замеру.** Числа в таблице сравнения мер (FR-004, FR-005, раздел Assumptions) названы формами распределений, а не решениями. Это сознательно: назначить порог здесь значило бы повторить ошибку нынешнего подпункта.
- **Исходная гипотеза хозяина записана как опровергнутая замером**, а не умолчана: скользящая средняя даёт медиану 50 % и задачу не решает, потому что чинить надо точку отсчёта, а не шум.
- **Цена изменения названа в самой спеке.** Работа НЕ добавочная: вердикты сдвинутся, методика ослабнет. FR-019 и SC-008 делают это условием приёмки, а не обещанием в тексте.
- **SC-009 проверен заранее** на пробных порогах (лучше 53 · без изменений 13 · хуже 0), но оставлен условием приёмки, потому что окончательный порог выбирается замером при планировании.
- **SC-004 отличается от аналогичных ворот прежних работ.** Там контрольный отпечаток обязан был НЕ сдвинуться; здесь он сдвинуться обязан, поэтому ворота переписаны на поимённый перечень полей, которым двигаться разрешено. Без этой оговорки ворота не сказали бы ничего.

**Готово к `/speckit.plan`.** Вопросов к хозяину нет: единственная развилка (какая именно мера решает статус, а какая объясняет) уже решена им в разговоре — решает длительность, объясняют глубина и месяц.
