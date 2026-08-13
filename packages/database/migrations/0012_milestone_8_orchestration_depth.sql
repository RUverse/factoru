ALTER TABLE task_runs ADD COLUMN gas_city_convoy_id TEXT;
ALTER TABLE task_runs ADD COLUMN gas_city_workflow_id TEXT;
ALTER TABLE task_runs ADD COLUMN event_cursor INTEGER NOT NULL DEFAULT 0 CHECK (event_cursor >= 0);
ALTER TABLE task_runs ADD COLUMN gas_city_event_cursor INTEGER NOT NULL DEFAULT 0 CHECK (gas_city_event_cursor >= 0);
ALTER TABLE task_runs ADD COLUMN last_complete_event_cursor INTEGER NOT NULL DEFAULT 0 CHECK (last_complete_event_cursor >= 0);
ALTER TABLE task_runs ADD COLUMN projection_state TEXT NOT NULL DEFAULT 'partial'
  CHECK (projection_state IN ('complete', 'partial', 'stale'));
ALTER TABLE task_runs ADD COLUMN projection_reason TEXT;
ALTER TABLE task_runs ADD COLUMN projection_reconciled_at TEXT;
ALTER TABLE task_runs ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 2);
ALTER TABLE task_runs ADD COLUMN correction_attempts INTEGER NOT NULL DEFAULT 0 CHECK (correction_attempts BETWEEN 0 AND 6);
ALTER TABLE task_runs ADD COLUMN transient_attempts INTEGER NOT NULL DEFAULT 0 CHECK (transient_attempts >= 0);
ALTER TABLE task_runs ADD COLUMN transient_attempt_limit INTEGER NOT NULL DEFAULT 6 CHECK (transient_attempt_limit > 0);

CREATE TABLE run_stages (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, stage_id)
);
CREATE TABLE run_dependencies (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  from_stage_id TEXT NOT NULL,
  to_stage_id TEXT NOT NULL,
  PRIMARY KEY (run_id, from_stage_id, to_stage_id)
);
CREATE TABLE run_units (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  session_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, unit_id)
);
CREATE TABLE run_sessions (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  transcript_cursor INTEGER NOT NULL DEFAULT 0 CHECK (transcript_cursor >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, session_id)
);
CREATE TABLE run_transcript_excerpts (
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  redacted INTEGER NOT NULL DEFAULT 0 CHECK (redacted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, session_id, sequence),
  FOREIGN KEY (run_id, session_id) REFERENCES run_sessions(run_id, session_id) ON DELETE CASCADE
);
CREATE TABLE run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_ref TEXT NOT NULL,
  content_blob BLOB,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX run_artifacts_run ON run_artifacts(run_id, created_at);
CREATE TABLE run_reviews (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  lane TEXT NOT NULL CHECK (lane IN ('correctness_testing', 'security_reliability', 'maintainability_architecture', 'synthesis')),
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  artifact_id TEXT REFERENCES run_artifacts(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, lane)
);
CREATE TABLE run_stream_events (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  cursor INTEGER NOT NULL CHECK (cursor > 0),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (run_id, cursor),
  UNIQUE (run_id, event_id)
);

CREATE TABLE task_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'scope', 'decision', 'check', 'review', 'artifact')),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4096),
  provenance_kind TEXT NOT NULL,
  provenance_ref TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX task_evidence_task ON task_evidence(task_id, created_at);
CREATE TABLE task_supersessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  child_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('split', 'merge')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (parent_task_id, child_task_id)
);
CREATE TABLE task_resource_intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('repository_path', 'service', 'database', 'exclusive_resource')),
  name TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('read', 'write', 'exclusive')),
  created_at TEXT NOT NULL,
  UNIQUE (task_id, kind, name)
);
CREATE TABLE duplicate_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('new_request', 'task')),
  source_ref TEXT NOT NULL,
  candidate_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('append_evidence', 'propose_merge', 'new_task', 'rejected')),
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX duplicate_decisions_project ON duplicate_decisions(project_id, created_at);
CREATE TABLE memory_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'worker_type')),
  worker_type_kind TEXT,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4096),
  provenance_kind TEXT NOT NULL,
  provenance_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  proposed_by TEXT NOT NULL,
  accepted_memory_id TEXT REFERENCES memory_entries(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((scope = 'project' AND worker_type_kind IS NULL) OR (scope = 'worker_type' AND worker_type_kind IN ('project_manager', 'software_engineer')))
);
CREATE INDEX memory_proposals_project ON memory_proposals(project_id, status, created_at);
CREATE TABLE run_memory_snapshots (
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  memory_entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
  content TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  PRIMARY KEY (run_id, memory_entry_id)
);

-- Preserve every historical coarse run as a recoverable projection summary.
INSERT INTO run_stages(run_id, stage_id, ordinal, title, status, payload_json)
SELECT id, stage, 0, stage,
  CASE WHEN status = 'completed' THEN 'completed'
       WHEN status IN ('failed', 'cancelled') THEN status
       WHEN status IN ('running', 'cancelling') THEN 'running'
       ELSE 'pending' END,
  json_object('legacySteps', json(steps_json), 'legacyLogs', json(logs_json))
FROM task_runs WHERE kind = 'implementation';

UPDATE worker_types SET allowed_tools_json =
  '["tasks.get","tasks.search","tasks.create","tasks.update","tasks.move","tasks.queue","tasks.propose_merge","tasks.resolve","tasks.set_dependencies","tasks.split","tasks.set_resource_intents","tasks.append_evidence","memory.read","memory.propose","memory.search","memory.propose_update","runs.inspect","capacity.inspect"]'
WHERE kind = 'project_manager';
UPDATE worker_types SET allowed_tools_json =
  '["tasks.get","memory.read","memory.search","memory.propose_update","runs.inspect","runs.context","runs.report_evidence","runs.report_review"]'
WHERE kind = 'software_engineer';
