CREATE TABLE factory_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  max_parallel_implementation_workers INTEGER NOT NULL DEFAULT 1
    CHECK (max_parallel_implementation_workers = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE worker_types (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('project_manager', 'software_engineer')),
  display_name TEXT NOT NULL,
  prompt_override TEXT,
  default_formula TEXT,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity = 1),
  allowed_tools_json TEXT NOT NULL,
  memory_policy TEXT NOT NULL CHECK (memory_policy = 'provenance_required'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE worker_model_bindings (
  project_id TEXT NOT NULL,
  worker_type_kind TEXT NOT NULL,
  slot TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, worker_type_kind, slot),
  FOREIGN KEY (project_id, worker_type_kind)
    REFERENCES worker_types(project_id, kind) ON DELETE CASCADE
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'project_manager'),
  gas_city_account_id TEXT NOT NULL,
  gas_city_conversation_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  transcript_cursor INTEGER NOT NULL DEFAULT 0 CHECK (transcript_cursor >= 0),
  status TEXT NOT NULL DEFAULT 'connecting'
    CHECK (status IN ('connecting', 'ready', 'offline', 'needs_attention')),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (gas_city_account_id, gas_city_conversation_id)
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL CHECK (length(text) > 0),
  author_display_name TEXT NOT NULL,
  in_reply_to_message_id TEXT,
  gas_city_sequence INTEGER CHECK (gas_city_sequence IS NULL OR gas_city_sequence > 0),
  delivery_state TEXT NOT NULL
    CHECK (delivery_state IN ('pending', 'delivered', 'failed')),
  token_input INTEGER CHECK (token_input IS NULL OR token_input >= 0),
  token_output INTEGER CHECK (token_output IS NULL OR token_output >= 0),
  tool_activity_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, gas_city_sequence)
);
CREATE INDEX conversation_messages_order
  ON conversation_messages(conversation_id, created_at, id);

CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'worker_type')),
  worker_type_kind TEXT CHECK (
    (scope = 'project' AND worker_type_kind IS NULL) OR
    (scope = 'worker_type' AND worker_type_kind IN ('project_manager', 'software_engineer'))
  ),
  content TEXT NOT NULL CHECK (length(content) > 0),
  provenance_kind TEXT NOT NULL CHECK (
    provenance_kind IN ('user_message', 'user_edit', 'task_evidence', 'system_import')
  ),
  provenance_ref TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_id TEXT REFERENCES memory_entries(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX memory_entries_scope
  ON memory_entries(project_id, scope, worker_type_kind, created_at);

CREATE TABLE planner_probes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  finished_at TEXT,
  CHECK (
    (status IN ('pending', 'running', 'cancelling') AND finished_at IS NULL) OR
    (status IN ('completed', 'failed', 'cancelled') AND finished_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX one_active_planner_probe_per_project
  ON planner_probes(project_id)
  WHERE status IN ('pending', 'running', 'cancelling');

-- Existing Milestone 2 projects receive the same deterministic built-in
-- template state as newly-created projects. New rows are initialized by the
-- database adapter in the project-creation transaction.
INSERT INTO factory_settings(
  project_id, template_id, template_version, max_parallel_implementation_workers,
  created_at, updated_at
)
SELECT id, 'software-project', 1, 1, created_at, updated_at FROM projects;

INSERT INTO worker_types(
  project_id, kind, display_name, prompt_override, default_formula, capacity,
  allowed_tools_json, memory_policy, created_at, updated_at
)
SELECT id, 'project_manager', 'Project Manager', NULL, 'queue-reconcile', 1,
  '["tasks.search","tasks.create","tasks.update","tasks.move","tasks.propose_merge","tasks.resolve","memory.read","memory.propose"]',
  'provenance_required', created_at, updated_at
FROM projects;

INSERT INTO worker_types(
  project_id, kind, display_name, prompt_override, default_formula, capacity,
  allowed_tools_json, memory_policy, created_at, updated_at
)
SELECT id, 'software_engineer', 'Software Engineer', NULL, 'software-delivery', 1,
  '["tasks.get","memory.read","runs.report_evidence"]',
  'provenance_required', created_at, updated_at
FROM projects;

INSERT INTO worker_model_bindings(project_id, worker_type_kind, slot, updated_at)
SELECT id, 'project_manager', 'chat', updated_at FROM projects
UNION ALL SELECT id, 'project_manager', 'planning', updated_at FROM projects
UNION ALL SELECT id, 'software_engineer', 'implementation', updated_at FROM projects
UNION ALL SELECT id, 'software_engineer', 'review', updated_at FROM projects;

INSERT INTO conversations(
  id, project_id, kind, gas_city_account_id, gas_city_conversation_id, agent_name,
  created_at, updated_at
)
SELECT
  'conv_' || substr(id, 5), id, 'project_manager', 'factoru-server',
  'conv_' || substr(id, 5), 'project-manager-chat-' || substr(id, 5, 12),
  created_at, updated_at
FROM projects;
