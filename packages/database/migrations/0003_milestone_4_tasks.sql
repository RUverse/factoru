ALTER TABLE factory_settings
  ADD COLUMN queue_revision INTEGER NOT NULL DEFAULT 0 CHECK (queue_revision >= 0);
ALTER TABLE factory_settings
  ADD COLUMN execution_wip_limit INTEGER NOT NULL DEFAULT 1 CHECK (execution_wip_limit = 1);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('backlog', 'queue', 'in_progress', 'needs_you')),
  queue_phase TEXT CHECK (queue_phase IN (
    'awaiting_triage', 'triaging', 'ready', 'waiting_dependency', 'waiting_capacity'
  )),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  queue_order INTEGER NOT NULL DEFAULT 0 CHECK (queue_order >= 0),
  worker_type_kind TEXT CHECK (worker_type_kind IN ('project_manager', 'software_engineer')),
  formula_name TEXT,
  needs_you_action TEXT CHECK (needs_you_action IN (
    'clarify', 'approve', 'review', 'resolve_conflict', 'recover_failure'
  )),
  needs_you_message TEXT,
  resolution TEXT CHECK (resolution IN ('accepted', 'rejected', 'cancelled', 'superseded')),
  resolution_summary TEXT,
  resolved_at TEXT,
  merged_into_task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('user', 'pm_chat', 'pm_planner')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  CHECK ((status = 'queue') = (queue_phase IS NOT NULL)),
  CHECK (
    (status = 'needs_you' AND needs_you_action IS NOT NULL AND length(trim(needs_you_message)) > 0)
    OR (status <> 'needs_you' AND needs_you_action IS NULL AND needs_you_message IS NULL)
  ),
  CHECK (
    (resolution IS NULL AND resolution_summary IS NULL AND resolved_at IS NULL)
    OR (resolution IS NOT NULL AND length(trim(resolution_summary)) > 0 AND resolved_at IS NOT NULL)
  ),
  CHECK ((resolution = 'superseded') = (merged_into_task_id IS NOT NULL))
);
CREATE INDEX tasks_active_board
  ON tasks(project_id, status, priority DESC, queue_order, updated_at)
  WHERE resolution IS NULL;
CREATE INDEX tasks_recent_history ON tasks(project_id, resolved_at DESC) WHERE resolution IS NOT NULL;

CREATE TABLE task_dependencies (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  needs_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, needs_task_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, needs_task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE,
  CHECK (task_id <> needs_task_id)
);

CREATE TABLE task_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_version INTEGER NOT NULL CHECK (task_version > 0),
  action TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'pm_chat', 'pm_planner', 'system')),
  actor_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX task_events_task_sequence ON task_events(task_id, sequence);

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('planning', 'implementation')),
  city_name TEXT NOT NULL,
  rig_name TEXT NOT NULL,
  formula_name TEXT NOT NULL,
  formula_version TEXT,
  run_id TEXT,
  workflow_root_bead_id TEXT,
  convoy_id TEXT,
  starting_event_cursor INTEGER NOT NULL CHECK (starting_event_cursor >= 0),
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'cancelling', 'completed', 'failed', 'cancelled')
  ),
  terminal_disposition TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (project_id, task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE
);
CREATE INDEX task_runs_task ON task_runs(task_id, created_at);

CREATE TABLE queue_reconciliations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_revision INTEGER NOT NULL CHECK (requested_revision > 0),
  coalesced_through_revision INTEGER NOT NULL CHECK (
    coalesced_through_revision >= requested_revision
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'cancelling', 'completed', 'failed', 'cancelled')
  ),
  run_id TEXT,
  workflow_root_bead_id TEXT,
  formula_hash TEXT,
  error_code TEXT,
  error_message TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX one_pending_queue_reconciliation
  ON queue_reconciliations(project_id) WHERE status = 'pending';
CREATE UNIQUE INDEX one_running_queue_reconciliation
  ON queue_reconciliations(project_id) WHERE status IN ('running', 'cancelling');

CREATE TABLE task_merge_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  proposed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK (source_task_id <> target_task_id)
);
CREATE UNIQUE INDEX one_pending_task_merge
  ON task_merge_proposals(source_task_id, target_task_id) WHERE status = 'pending';

CREATE TABLE agent_tool_credentials (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('pm_chat', 'pm_planner', 'software_implementer', 'software_reviewer')
  ),
  session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE agent_tool_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  credential_id TEXT NOT NULL REFERENCES agent_tool_credentials(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'denied', 'failed')),
  summary_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (credential_id, request_id)
);
