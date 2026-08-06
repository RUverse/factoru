CREATE TABLE server_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  server_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE TABLE pairing_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  repository_root_id TEXT NOT NULL,
  repository_relative_path TEXT NOT NULL,
  repository_real_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  setup_state TEXT NOT NULL CHECK (setup_state IN ('setting_up', 'ready', 'needs_attention')),
  setup_error_code TEXT,
  setup_error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_rig_bindings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  city_name TEXT NOT NULL,
  rig_name TEXT NOT NULL UNIQUE,
  bead_prefix TEXT NOT NULL UNIQUE,
  registration_state TEXT NOT NULL CHECK (registration_state IN ('pending', 'ready', 'failed')),
  last_reconciled_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT
);

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES trusted_devices(id) ON DELETE RESTRICT,
  method TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE domain_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  command_id TEXT,
  causation_id TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX domain_events_aggregate_sequence
  ON domain_events(aggregate_type, aggregate_id, sequence);

CREATE TABLE outbox_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX outbox_due ON outbox_items(status, available_at);

CREATE TABLE projection_cursors (
  owner TEXT NOT NULL,
  stream TEXT NOT NULL,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, stream)
);
