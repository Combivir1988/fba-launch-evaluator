# Specification Quality Checklist: Возвраты в экономике и план запуска

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
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

**Один открытый вопрос — FR-002, модель возврата.** Он не закрыт умолчанием сознательно: от него зависит КАЖДОЕ число экономики, а значит и вердикты всех существующих анализов. Выбрать долю пригодного к перепродаже товара «на глаз» означало бы подменить решение господаря придуманным числом — ровно та ошибка, против которой написаны ворота SC-002 и SC-004.

Остальные неясности закрыты умолчаниями и записаны в допущениях: доля возвратов из отчёта относится к нише, а не к товару (поэтому ручной ввод обязателен); сценарии различаются скоростью разгона, а не целью; направление концентрации берётся только из отчёта с историей, потому что уровень концентрации — снимок.

**Чем держится спека.** Исходный дефект проверен в коде 2026-11-12: доля возвратов читается из отчёта и показывается в обзоре, но в расчёте прибыли не участвует ни разу. US2–US4 опираются на показатели, которые уже вычисляются: безубыточный CVR, целевой расход на рекламу, срок поставки, уровень концентрации, рост поискового объёма и история структуры ниши.

**Два критерия написаны так, чтобы их можно было провалить.** SC-002 требует, чтобы ниши без возвратов не сдвинулись ни на копейку — это ловит случайное изменение формулы там, где его быть не должно. SC-004 требует, чтобы неизвестная доля возвратов не превращалась в ноль — это ловит самую вероятную реализацию «через значение по умолчанию», при которой приложение молча начинает утверждать, что возвратов нет.
