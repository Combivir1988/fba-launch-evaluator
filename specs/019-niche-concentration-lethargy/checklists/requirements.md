# Specification Quality Checklist: Концентрация ниши и летаргия брендов

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-03
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

**Почему нет ни одного [NEEDS CLARIFICATION].** Три вопроса, которые были открыты при обсуждении, господарь закрыл до написания спецификации: концентрация считается по брендам (не по листингам), порог прохождения Критерия 1 остаётся 6 из 8, сглаживающий коэффициент равен 0,01 и един для числителя и знаменателя.

**Чем эта спецификация держится.** Каждое пороговое значение и каждый критерий успеха взяты из замера на 65 живых анализах 2026-11-03, а не выбраны по виду. В частности:

- 1f зелёный в 1 нише из 65 — отсюда вся работа;
- концентрация даёт 28 зелёных из 65 при пороге 1500, разброс 616…6427;
- зависимость от глубины выгрузки: 0,38 у концентрации против 0,58 у прежнего показателя и 0,70 у доли топ-5 листингов;
- ярлык «спящий гигант» достаётся 13 брендам из 171 крупного (8 %) — отсюда SC-005;
- отсечка без порога по деньгам срабатывала бы в 61 нише из 65, поэтому порог по деньгам записан требованием, а не рекомендацией.

**Что проверяется воротами.** SC-006 (летаргия не меняет ни одного решения) написан так, чтобы его можно было провалить: он сравнивает вердикты, статусы критериев, чеклист и Scorecard при включённой и выключенной летаргии на всех 65 анализах. SC-002 и SC-003 ловят обратное — замена подпункта 1f **обязана** сдвинуть часть вердиктов, и каждый сдвиг должен быть объясним.
