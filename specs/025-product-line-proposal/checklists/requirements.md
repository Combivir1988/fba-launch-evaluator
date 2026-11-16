# Specification Quality Checklist: Предлагаемая товарная линейка

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-16
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

**Три решения, принятые замером, а не вкусом — и это записано в спеке:**

1. Работа вообще имеет смысл: 88,6 % денег ниши у семей из нескольких вариаций, у ТОП-10 лидеров медиана 5 ASIN, одиночек 10 %. Замер снят с 67 живых ниш чтением базы.
2. Третий источник (ключевые слова) ПЕРЕОПРЕДЕЛЁН до написания спеки: наивное правило «дырок спроса» на живых данных выдаёт `duct` в нише joist tape (201 851 SV, чужой товар) наравне с `20x20x1` в нише фильтров (настоящий размер) — примерно половина на половину. Поэтому ключи понижены до подтверждения спроса, а не источника вариантов, и это закреплено воротами SC-002.
3. Ниша без осей — не пустой блок, а ответ. Живой случай: 21 поле схемы, 8 семей, ноль осей. Закреплено воротами SC-001.

**Три величины намеренно НЕ названы числами в спеке** — число ASIN, порог доли выручки у значения оси и правило отсечения чужих слов. Все три выбираются замером при планировании. Назначить их сейчас значило бы повторить дефект «порог, который ничего не различает» (прецеденты: spec 018 — подпункт зелёный в 1 нише из 65; spec 019; spec 024 — условное сообщение о сосредоточенности, снятое замером).

**Развилка решена явно, а не умолчанием**: линейка вырезается из публичной ссылки вместе с ТЗ (FR-018, ворота SC-005). Прецеденты существуют в обе стороны — диаграммы этапа 2 едут, ТЗ и этап 3 вырезаются — поэтому выбор обоснован природой содержимого: это замысел своего товара, а не рыночные данные.

**Граница «не трогаем экономику» сделана проверяемой** (SC-003, SC-004), а не обещанной в тексте.
