ALTER TABLE task_runs ADD COLUMN formula_hash TEXT;
ALTER TABLE task_runs ADD COLUMN capsule_id TEXT;
ALTER TABLE task_runs ADD COLUMN capsule_path TEXT;
ALTER TABLE task_runs ADD COLUMN branch_name TEXT;
ALTER TABLE task_runs ADD COLUMN base_branch TEXT;
ALTER TABLE task_runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'admission' CHECK (
  stage IN (
    'admission', 'capsule', 'implementation', 'checks', 'review',
    'integration', 'needs_you', 'terminal'
  )
);
ALTER TABLE task_runs ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_runs ADD COLUMN logs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_runs ADD COLUMN usage_json TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"estimatedCostUsd":0}';
ALTER TABLE task_runs ADD COLUMN review_package_json TEXT NOT NULL DEFAULT 'null';
ALTER TABLE task_runs ADD COLUMN error_code TEXT;
ALTER TABLE task_runs ADD COLUMN error_message TEXT;
ALTER TABLE task_runs ADD COLUMN updated_at TEXT;
ALTER TABLE task_runs ADD COLUMN archived_at TEXT;

UPDATE task_runs SET updated_at = created_at WHERE updated_at IS NULL;

CREATE UNIQUE INDEX one_active_implementation_run_per_project
  ON task_runs(project_id)
  WHERE kind = 'implementation' AND status IN ('pending', 'running', 'cancelling');
CREATE UNIQUE INDEX one_active_implementation_run_per_task
  ON task_runs(task_id)
  WHERE kind = 'implementation' AND status IN ('pending', 'running', 'cancelling');
