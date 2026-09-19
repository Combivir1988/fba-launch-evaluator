-- spec 002: учётные записи, сеансы, общая история, публичные ссылки, журнал задач
-- (см. specs/002-team-accounts-sharing/data-model.md)

CREATE TABLE users (
  id uuid PRIMARY KEY,
  login text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'user')),
  active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ua text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE analyses (
  id uuid PRIMARY KEY,
  niche text NOT NULL DEFAULT '',
  core_keyword text NOT NULL DEFAULT '',
  verdict text,
  c1_score int,
  score numeric,
  sources text[] NOT NULL DEFAULT '{}',
  ai_done boolean NOT NULL DEFAULT false,
  patents_done boolean NOT NULL DEFAULT false,
  core jsonb NOT NULL,
  aggregates_gz bytea,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX analyses_updated_idx ON analyses (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX analyses_author_idx ON analyses (created_by);

CREATE TABLE shares (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  analysis_id uuid NOT NULL REFERENCES analyses(id),
  created_by uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('full', 'no_economics')),
  snapshot_gz bytea NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  snapshot_version int NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  views int NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shares_analysis_idx ON shares (analysis_id);

CREATE TABLE job_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  analysis_id uuid,
  niche text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('analyze', 'patents')),
  model text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('running', 'done', 'error', 'cancelled', 'interrupted')),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX job_log_started_idx ON job_log (started_at DESC);
CREATE INDEX job_log_user_idx ON job_log (user_id, started_at DESC);
