-- spec 021: радар товарных идей.
--
-- Первая сущность приложения, не выводимая из анализа: раздел живёт во времени и файлов не имеет,
-- а анализ — это снимок загруженных файлов. Поэтому миграция здесь нужна (в отличие от спек 019 и 020).

-- Право на раздел — ОТДЕЛЬНАЯ колонка, дословно как stats_access (D11). Не ключ в users.settings:
-- settings пишет сам пользователь через PATCH /api/auth/settings, и флаг прав в поле, которое человек
-- имеет право менять, — это повышение прав на расстоянии одной будущей правки белого списка.
ALTER TABLE users ADD COLUMN ideas_access boolean NOT NULL DEFAULT false;

-- Заведённый раздел площадки: «где смотреть».
CREATE TABLE idea_source (
  id             uuid PRIMARY KEY,
  platform       text NOT NULL CHECK (platform IN ('channel', 'video', 'crowdfunding')),
  handle         text NOT NULL,                 -- категория, тема или имя канала
  title          text NOT NULL,                 -- как человек его назвал
  active         boolean NOT NULL DEFAULT true, -- приостановлен человеком
  paused_reason  text,                          -- приостановлен системой после отказов подряд — причина
  threshold_mult numeric,                       -- своя кратность порога; NULL — из общих порогов
  fails_in_row   integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- один и тот же раздел не заводится дважды: иначе одну нишу обходили бы два раза за двойной расход
  CONSTRAINT uq_idea_source UNIQUE (platform, handle)
);

-- Суточный обход одного раздела.
CREATE TABLE idea_run (
  source_id    uuid NOT NULL REFERENCES idea_source(id) ON DELETE CASCADE,
  run_date     date NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  fail_code    text,
  fail_message text,
  seen_count   integer,
  passed_count integer,
  no_metric    integer,
  background   jsonb,                           -- медиана фона и размер выборки, по которым считался отбор
  spent        numeric,
  via          text,                            -- прямой запрос или обход защиты (D7)
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  -- ПЕРВИЧНЫЙ КЛЮЧ (source_id, run_date) — это и есть защита от повторного обхода в те же сутки
  -- и от двойного расхода после перезапуска. Правило держит БАЗА, а не договорённость в коде.
  PRIMARY KEY (source_id, run_date),
  -- связь «неудача ⟺ названа причина»: строка failed без причины невозможна,
  -- а именно такая строка и выглядела бы в ленте пустотой (ворота SC-002)
  CONSTRAINT ck_run_fail_has_reason CHECK ((status = 'failed') = (fail_code IS NOT NULL))
);

-- Элемент, НЕ прошедший отбор. Живёт несколько суток и удаляется: нужен ровно затем,
-- чтобы человек подвинул порог и сразу увидел результат на настоящих данных.
CREATE TABLE idea_item (
  id           uuid PRIMARY KEY,
  source_id    uuid NOT NULL REFERENCES idea_source(id) ON DELETE CASCADE,
  run_date     date NOT NULL,
  external_id  text NOT NULL,
  title        text,
  url          text,
  published_at timestamptz,                     -- NULL — площадка даты не сказала
  metric       numeric,                         -- NULL — показателя нет; это НЕ ноль
  raw          jsonb,
  CONSTRAINT uq_idea_item UNIQUE (source_id, run_date, external_id)
);
CREATE INDEX ix_idea_item_cleanup ON idea_item (run_date);

-- Прошедший отбор. Живёт долго: это и есть лента и память решений.
CREATE TABLE idea_candidate (
  id            uuid PRIMARY KEY,
  source_id     uuid REFERENCES idea_source(id) ON DELETE SET NULL, -- раздел удалён — кандидат остаётся
  platform      text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  url           text NOT NULL,
  snippet       text,
  published_at  timestamptz,
  first_seen_on date NOT NULL,
  last_seen_on  date NOT NULL,
  days_held     integer NOT NULL DEFAULT 1,
  metric        numeric NOT NULL,
  background    numeric NOT NULL,
  ratio         numeric NOT NULL,
  platforms     text[] NOT NULL DEFAULT '{}',
  decision      text NOT NULL DEFAULT 'none' CHECK (decision IN ('none', 'kept', 'dismissed')),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  analysis_id   uuid REFERENCES analyses(id) ON DELETE SET NULL,
  -- один элемент — одна запись: повторное появление поднимает last_seen_on и days_held,
  -- а не создаёт вторую строку. Отклонённое НЕ удаляется — иначе следующий обход вернул бы его как новое.
  CONSTRAINT uq_idea_candidate UNIQUE (source_id, external_id)
);
CREATE INDEX ix_idea_candidate_feed ON idea_candidate (last_seen_on DESC);

-- Расход по суткам. Отдельная строка, а не сумма по idea_run: потолок проверяется ДО запуска
-- очередного обхода и дешёвым запросом, а не сложением всех обходов дня.
CREATE TABLE idea_spend (
  spend_date date PRIMARY KEY,
  spent      numeric NOT NULL DEFAULT 0
);
