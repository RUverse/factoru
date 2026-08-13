ALTER TABLE projects ADD COLUMN project_directory TEXT;
ALTER TABLE projects ADD COLUMN managed_project_directory INTEGER NOT NULL DEFAULT 0
  CHECK (managed_project_directory IN (0, 1));

ALTER TABLE project_repositories ADD COLUMN source_repository_real_path TEXT;

CREATE UNIQUE INDEX projects_managed_directory_unique
  ON projects(project_directory) WHERE project_directory IS NOT NULL;

CREATE INDEX project_repositories_by_source_path
  ON project_repositories(source_repository_real_path)
  WHERE source_repository_real_path IS NOT NULL;
