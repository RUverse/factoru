ALTER TABLE factory_settings ADD COLUMN blueprint_id TEXT NOT NULL
  DEFAULT 'standard-software-project'
  CHECK (blueprint_id IN ('standard-software-project', 'fast-patch'));
ALTER TABLE factory_settings ADD COLUMN blueprint_version INTEGER NOT NULL DEFAULT 1
  CHECK (blueprint_version > 0);
ALTER TABLE factory_settings ADD COLUMN default_workflow_preset_id TEXT NOT NULL
  DEFAULT 'standard-build'
  CHECK (default_workflow_preset_id IN ('standard-build', 'fast-patch'));

ALTER TABLE tasks ADD COLUMN workflow_preset_id TEXT
  CHECK (workflow_preset_id IN ('standard-build', 'fast-patch'));
ALTER TABLE tasks ADD COLUMN workflow_selection_source TEXT NOT NULL
  DEFAULT 'blueprint_default'
  CHECK (workflow_selection_source IN (
    'blueprint_default', 'project_default', 'pm', 'user'
  ));
ALTER TABLE tasks ADD COLUMN workflow_locked_by_user INTEGER NOT NULL DEFAULT 0
  CHECK (workflow_locked_by_user IN (0, 1));

ALTER TABLE task_runs ADD COLUMN workflow_preset_id TEXT
  CHECK (workflow_preset_id IN ('standard-build', 'fast-patch'));
ALTER TABLE task_runs ADD COLUMN workflow_preset_version INTEGER
  CHECK (workflow_preset_version IS NULL OR workflow_preset_version > 0);
ALTER TABLE task_runs ADD COLUMN resolved_vars_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE task_runs ADD COLUMN blueprint_id TEXT;
ALTER TABLE task_runs ADD COLUMN blueprint_version INTEGER;
ALTER TABLE task_runs ADD COLUMN pack_lock_digest TEXT;
ALTER TABLE task_runs ADD COLUMN source_bead_id TEXT;

UPDATE factory_settings
SET template_version = 2,
    blueprint_id = 'standard-software-project',
    blueprint_version = 1,
    default_workflow_preset_id = 'standard-build';

UPDATE worker_types
SET default_formula = 'standard-build', version = version + 1
WHERE kind = 'software_engineer';

INSERT INTO worker_model_bindings(
  project_id, worker_type_kind, slot, provider, model, version, updated_at
)
SELECT planning.project_id, 'software_engineer', 'design',
       planning.provider, planning.model, planning.version, planning.updated_at
FROM worker_model_bindings planning
WHERE planning.worker_type_kind = 'project_manager' AND planning.slot = 'planning';

UPDATE tasks
SET workflow_preset_id = 'fast-patch',
    workflow_selection_source = 'project_default',
    workflow_locked_by_user = 0
WHERE status = 'in_progress' AND formula_name = 'software-delivery';

UPDATE tasks
SET workflow_preset_id = 'standard-build',
    workflow_selection_source = 'project_default',
    workflow_locked_by_user = 0,
    worker_type_kind = 'software_engineer',
    formula_name = 'standard-build',
    queue_phase = 'awaiting_triage'
WHERE status = 'queue';

UPDATE task_runs
SET workflow_preset_id = CASE
      WHEN formula_name = 'software-delivery' THEN 'fast-patch'
      WHEN formula_name = 'standard-build' THEN 'standard-build'
      ELSE NULL
    END,
    workflow_preset_version = CASE
      WHEN formula_name IN ('software-delivery', 'standard-build') THEN 1
      ELSE NULL
    END,
    blueprint_id = 'standard-software-project',
    blueprint_version = 1,
    pack_lock_digest = 'legacy:factoru-default@0.3.0';
