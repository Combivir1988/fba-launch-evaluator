# Specification Quality Checklist: Отзывы в отчёте — судить по тому, что приложение уже знает

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-14
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

**Имена файлов и строк кода из входных данных в спеку НЕ перенесены намеренно.** Они принадлежат плану, а не спеке: спека говорит, что отчёт не должен противоречить сам себе, а не в какой строке это починить. Все замеры при этом сохранены — они и есть основание требований.

**Трёх вопросов на уточнение нет**, и это не упущение. Обычно спорными были бы три решения, но каждое уже закрыто замером:

1. *Медиана или среднее?* — измерено: на среднем пороги не различают (42 из 67 в «не OK»), на медиане различают (32 / 20 / 15).
2. *Не ослабляем ли методику?* — измерено подстановкой в ядро: вердикт сдвигается у **одного** анализа из 69, и только в лучшую сторону.
3. *Насколько опасно смягчить вывод о рве?* — измерена верхняя граница: штраф снят целиком, вердикт не сдвинулся **ни у одного** анализа.

**Один замер пришлось переделать, и это записано в SC-005.** Первая попытка измерить сдвиг вердиктов дала ложный ноль: подстановка в ядро не подхватилась, потому что модуль брался из кэша внутри одного процесса. Правильный замер делается **двумя отдельными процессами**. Ожидаемые числа (41 / 1 / 1) занесены в критерий именно поэтому: если реализация даст заметно другое, это признак, что меряется не то.

**SC-007 — самое важное для доверия**: ни один анализ не должен получить вердикт хуже прежнего. Работа снимает ложные препятствия; появление нового означало бы, что сделано что-то сверх задуманного.
