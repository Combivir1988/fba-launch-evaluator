-- spec 009: история версий анализа. Каждое сохранение архивирует ПРЕЖНЕЕ состояние (core, а при замене отчётов — и aggregates_gz).
-- state_at / state_by — когда и кем было записано архивируемое состояние; archived_at / archived_by — когда и чьё сохранение его вытеснило.
CREATE TABLE analysis_versions (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  version integer NOT NULL,
  core jsonb NOT NULL,
  aggregates_gz bytea,
  state_at timestamptz NOT NULL,
  state_by uuid REFERENCES users(id) ON DELETE SET NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'save'
);
CREATE INDEX analysis_versions_analysis_idx ON analysis_versions (analysis_id, archived_at DESC);
