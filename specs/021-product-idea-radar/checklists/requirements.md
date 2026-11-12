# Specification Quality Checklist: Радар товарных идей (этап 1)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-12
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

**Спека переписана целиком 2026-11-12 после исправления господаря.** Первая редакция называлась «Наблюдение за нишей» и была написана не про то: она предполагала, что ниша уже есть и человек вводит её ключевые слова, то есть **подтверждала готовую гипотезу**. Нужен был обратный шаг — **поиск гипотезы**: раздел приносит товарные идеи, которых человек ещё не знает, и к конкретной нише не привязан вовсе.

Два решения господаря, определившие переписанную редакцию:

1. **Место — верхний ряд, рядом со «Статистикой»**, а не ряд этапов внутри анализа. Ряд этапов рисуется внутри анализа и целиком уезжает в публичную ссылку и скачанный файл; радар там показывал бы одно и то же в каждой нише и утекал бы наружу. Отсюда FR-002, FR-003 и SC-011.
2. **Разделы площадок задаёт человек, идеи приходят оттуда сами.** Вариант «совсем без настройки» отклонён как неработающий на двух площадках из трёх: краудфандинг общую ленту отдаёт, а видео без темы и мессенджер без списка каналов не отдают ничего.

**Главное требование, которого не было в первой редакции, — FR-011/FR-012: отбор от фона собственного раздела.** Это и есть продукт. Общий порог выключил бы маленькие источники, а именно в них раньше всего видно новое. Закреплено воротами SC-003: два канала, различающиеся по аудитории в сто раз, обязаны дать кандидатов оба.

**Второе требование, которое легко потерять, — FR-017/SC-005: раздел не оценивает пригодность к продаже.** Большая часть выбившегося товаром не является. Раздел, который начнёт выдавать «перспективные товарные идеи», будет врать, и по нему закупят партию.

**Трое ворот:**

- **SC-002** — отказ источника нигде не выглядит как пустота.
- **SC-003** — отбор считается от собственного фона раздела.
- **SC-009** — создание анализа из идеи не меняет ни одного существующего анализа и ни одного вердикта; проверяется контрольным отпечатком результатов, который в репозитории уже есть.

Ни одного [NEEDS CLARIFICATION] не оставлено: во всех спорных местах выбран вариант и записана причина в Assumptions.
