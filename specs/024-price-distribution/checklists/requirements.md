# Specification Quality Checklist: Распределение цен в нише — показать, откуда взялась цена

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

**Все пункты пройдены.** Четыре решения, принятые при проверке, записаны здесь явно:

1. **Ни одного маркера [NEEDS CLARIFICATION].** Два места выглядели как требующие вопроса, и оба закрыты прямым указанием господаря, а не догадкой: источник диаграммы («на підставі всіх лістингів, а не тих які парсяться на другому етапі») и число коридоров («можливо до 10»).

2. **Пороги намеренно не заданы числами.** Правило нарезки, порог «подавляющей доли» и порог сосредоточенности выручки требуются к выбору **замером** (FR-005, FR-012, FR-017). Исходные замеры 14 ноября приложены как отправная точка. Назначить их в спеке означало бы выбрать вкусом то, что уже умеем мерить.

3. **Записано опровержение собственной осторожности.** Ожидалось, что равный шаг сломается в большинстве ниш из-за разброса цен до 800×. Замер на 67 нишах показал обратное: при равном шаге самый толстый коридор держит в медиане 43 % выручки, пустых коридоров — одна из десяти. Проблема оказалась не в правиле, а в краях, и её масштаб — 17 ниш из 67, а не большинство. Ожидание исправлено **до** того, как под него написали требование.

4. **SC-003 опирается на контрольный отпечаток результатов** — проектный словарь приёмки (спеки 019, 020, 022), а не деталь реализации. Для добавочной работы это единственный способ доказать «ничего лишнего не задето».

**Все числа ожиданий** получены замером 14 ноября 2026 на 67 живых анализах с выгрузкой Xray, чтением базы без единой записи. Существенное расхождение при выполнении — повод остановиться и разобраться, а не поправить ожидание.
