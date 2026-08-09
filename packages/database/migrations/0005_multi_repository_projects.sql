CREATE TABLE project_repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  source_url TEXT,
  repository_root_id TEXT NOT NULL,
  repository_relative_path TEXT NOT NULL,
  repository_real_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  city_name TEXT NOT NULL,
  rig_name TEXT NOT NULL UNIQUE,
  bead_prefix TEXT NOT NULL UNIQUE,
  registration_state TEXT NOT NULL CHECK (registration_state IN ('pending', 'ready', 'failed')),
  last_reconciled_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX project_repositories_one_primary
  ON project_repositories(project_id) WHERE is_primary = 1;
CREATE INDEX project_repositories_by_project
  ON project_repositories(project_id, is_primary DESC, created_at);

INSERT INTO project_repositories(
  id, project_id, is_primary, source_url, repository_root_id,
  repository_relative_path, repository_real_path, default_branch,
  city_name, rig_name, bead_prefix, registration_state,
  last_reconciled_at, last_error_code, last_error_message, created_at, updated_at
)
SELECT
  'repo_' || substr(p.id, 5), p.id, 1, NULL, p.repository_root_id,
  p.repository_relative_path, p.repository_real_path, p.default_branch,
  r.city_name, r.rig_name, r.bead_prefix, r.registration_state,
  r.last_reconciled_at, r.last_error_code, r.last_error_message, p.created_at, p.updated_at
FROM projects p
JOIN project_rig_bindings r ON r.project_id = p.id;
