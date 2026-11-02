-- spec 018: раздел «Статистика по всем анализам».
--
-- Право на раздел — ОТДЕЛЬНАЯ колонка, а не ключ в users.settings: settings пишет сам пользователь
-- через PATCH /api/auth/settings. Сегодня там белый список ключей, но флаг прав в поле, которое человек
-- имеет право менять, — это повышение прав на расстоянии одной будущей правки (D6).
ALTER TABLE users ADD COLUMN stats_access boolean NOT NULL DEFAULT false;

-- Пересчитанный итог одного анализа (~1,7 КБ, замер). Производное хранилище: его можно удалить целиком,
-- и следующее открытие раздела восстановит его из анализов. Обратное неверно — поэтому пересчёт
-- ничего не пишет в analyses (FR-009, SC-007).
CREATE TABLE analysis_outcome (
  analysis_id uuid PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  version     integer NOT NULL,                 -- analyses.version на момент расчёта: разошлось — итог устарел
  method_hash text NOT NULL,                    -- версия методики (хэш shared/*.js): разошлась — итог устарел даже без правки данных (FR-026)
  status      text NOT NULL CHECK (status IN ('ok', 'empty', 'error')),
  outcome     jsonb,
  error       text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  -- связь «посчитан ⟺ есть итог» держит база, а не договорённость
  CONSTRAINT ck_outcome_only_when_ok CHECK ((status = 'ok') = (outcome IS NOT NULL))
);
