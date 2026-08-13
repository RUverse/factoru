import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations } from './migrations.js'

const directories: string[] = []

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-migrations-'))
  directories.push(directory)
  return { directory, database: new Database(':memory:') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('forward migrations', () => {
  it('applies sequential migrations once', () => {
    const { directory, database } = fixture()
    fs.writeFileSync(path.join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
    fs.writeFileSync(path.join(directory, '0002_second.sql'), 'CREATE TABLE second(id INTEGER);')
    applyMigrations(database, directory)
    applyMigrations(database, directory)
    expect(database.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
    ])
    database.close()
  })

  it('rolls a failed migration back transactionally', () => {
    const { directory, database } = fixture()
    fs.writeFileSync(
      path.join(directory, '0001_broken.sql'),
      'CREATE TABLE should_rollback(id INTEGER); THIS IS NOT SQL;',
    )
    expect(() => applyMigrations(database, directory)).toThrow()
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
        .get(),
    ).toBeUndefined()
    expect(database.prepare('SELECT COUNT(*) AS count FROM migrations').get()).toEqual({ count: 0 })
    database.close()
  })

  it('refuses a database created by a newer schema', () => {
    const { directory, database } = fixture()
    fs.writeFileSync(path.join(directory, '0001_first.sql'), 'CREATE TABLE first(id INTEGER);')
    applyMigrations(database, directory)
    database
      .prepare('INSERT INTO migrations(version, name, applied_at) VALUES (2, ?, ?)')
      .run('0002_future.sql', new Date().toISOString())
    expect(() => applyMigrations(database, directory)).toThrow(/newer than this Factoru binary/)
    database.close()
  })

  it('backfills Milestone 3 product state for an existing Milestone 2 project', () => {
    const { directory, database } = fixture()
    fs.copyFileSync(
      new URL('../migrations/0001_milestone_2.sql', import.meta.url),
      path.join(directory, '0001_milestone_2.sql'),
    )
    applyMigrations(database, directory)
    database
      .prepare(
        `INSERT INTO projects(
           id, name, repository_root_id, repository_relative_path, repository_real_path,
           default_branch, setup_state, created_at, updated_at
         ) VALUES (?, 'Existing', 'root', 'existing', '/repos/existing', 'dev', 'ready', ?, ?)`,
      )
      .run(
        'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-06T10:00:00.000Z',
        '2026-08-06T10:00:00.000Z',
      )
    fs.copyFileSync(
      new URL('../migrations/0002_milestone_3_product_model.sql', import.meta.url),
      path.join(directory, '0002_milestone_3_product_model.sql'),
    )
    applyMigrations(database, directory)
    expect(
      database
        .prepare('SELECT kind FROM worker_types WHERE project_id = ? ORDER BY kind')
        .all('prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toEqual([{ kind: 'project_manager' }, { kind: 'software_engineer' }])
    expect(
      database
        .prepare('SELECT id, transcript_cursor FROM conversations WHERE project_id = ?')
        .get('prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toEqual({ id: 'conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', transcript_cursor: 0 })
    database.close()
  })

  it('adds the Milestone 4 task model without inventing a terminal board status', () => {
    const { directory, database } = fixture()
    for (const name of [
      '0001_milestone_2.sql',
      '0002_milestone_3_product_model.sql',
      '0003_milestone_4_tasks.sql',
    ]) {
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    const taskSql = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get() as { sql: string }
    expect(taskSql.sql).toContain("'backlog', 'queue', 'in_progress', 'needs_you'")
    expect(taskSql.sql).not.toContain("'done'")
    expect(database.prepare('SELECT execution_wip_limit FROM factory_settings').all()).toEqual([])
    database.close()
  })

  it('adds the Milestones 5 and 6 execution evidence without changing task statuses', () => {
    const { directory, database } = fixture()
    for (const name of [
      '0001_milestone_2.sql',
      '0002_milestone_3_product_model.sql',
      '0003_milestone_4_tasks.sql',
      '0004_milestones_5_6_delivery.sql',
    ]) {
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    const columns = database.prepare('PRAGMA table_info(task_runs)').all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'formula_hash',
        'capsule_id',
        'capsule_path',
        'stage',
        'steps_json',
        'logs_json',
        'usage_json',
        'review_package_json',
        'archived_at',
      ]),
    )
    const taskSql = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get() as { sql: string }
    expect(taskSql.sql).not.toContain("'done'")
    database.close()
  })

  it('backfills each existing project into a primary repository rig', () => {
    const { directory, database } = fixture()
    for (const name of [
      '0001_milestone_2.sql',
      '0002_milestone_3_product_model.sql',
      '0003_milestone_4_tasks.sql',
      '0004_milestones_5_6_delivery.sql',
    ]) {
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    database
      .prepare(
        `INSERT INTO projects(
           id, name, repository_root_id, repository_relative_path, repository_real_path,
           default_branch, setup_state, created_at, updated_at
         ) VALUES (?, 'Existing', 'root', 'existing', '/repos/existing', 'dev', 'ready', ?, ?)`,
      )
      .run(
        'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-09T10:00:00.000Z',
        '2026-08-09T10:00:00.000Z',
      )
    database
      .prepare(
        `INSERT INTO project_rig_bindings(
           project_id, city_name, rig_name, bead_prefix, registration_state
         ) VALUES (?, 'factoru', 'factoru-existing', 'fexist', 'ready')`,
      )
      .run('prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    fs.copyFileSync(
      new URL('../migrations/0005_multi_repository_projects.sql', import.meta.url),
      path.join(directory, '0005_multi_repository_projects.sql'),
    )
    applyMigrations(database, directory)
    expect(database.prepare('SELECT * FROM project_repositories').get()).toMatchObject({
      project_id: 'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      is_primary: 1,
      repository_real_path: '/repos/existing',
      rig_name: 'factoru-existing',
      registration_state: 'ready',
    })
    database.close()
  })

  it('marks existing projects as unmanaged while adding managed project directories', () => {
    const { directory, database } = fixture()
    for (const name of [
      '0001_milestone_2.sql',
      '0002_milestone_3_product_model.sql',
      '0003_milestone_4_tasks.sql',
      '0004_milestones_5_6_delivery.sql',
      '0005_multi_repository_projects.sql',
    ]) {
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    database
      .prepare(
        `INSERT INTO projects(
           id, name, repository_root_id, repository_relative_path, repository_real_path,
           default_branch, setup_state, created_at, updated_at
         ) VALUES (?, 'Legacy', 'root', 'legacy', '/repos/legacy', 'dev', 'ready', ?, ?)`,
      )
      .run(
        'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-12T10:00:00.000Z',
        '2026-08-12T10:00:00.000Z',
      )
    fs.copyFileSync(
      new URL('../migrations/0006_managed_project_directories.sql', import.meta.url),
      path.join(directory, '0006_managed_project_directories.sql'),
    )
    applyMigrations(database, directory)
    const projectColumns = database.prepare('PRAGMA table_info(projects)').all() as Array<{
      name: string
    }>
    const repositoryColumns = database
      .prepare('PRAGMA table_info(project_repositories)')
      .all() as Array<{ name: string }>
    expect(projectColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['project_directory', 'managed_project_directory']),
    )
    expect(repositoryColumns.map(({ name }) => name)).toContain('source_repository_real_path')
    expect(
      database
        .prepare('SELECT project_directory, managed_project_directory FROM projects WHERE id = ?')
        .get('prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).toEqual({ project_directory: null, managed_project_directory: 0 })
    database.close()
  })

  it('migrates legacy projects to Blueprint defaults while preserving active delivery runs', () => {
    const { directory, database } = fixture()
    fs.copyFileSync(
      new URL('../migrations/0001_milestone_2.sql', import.meta.url),
      path.join(directory, '0001_milestone_2.sql'),
    )
    applyMigrations(database, directory)
    const projectId = 'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const now = '2026-08-12T10:00:00.000Z'
    database
      .prepare(
        `INSERT INTO projects(
           id, name, repository_root_id, repository_relative_path, repository_real_path,
           default_branch, setup_state, created_at, updated_at
         ) VALUES (?, 'Legacy', 'root', 'legacy', '/repos/legacy', 'dev', 'ready', ?, ?)`,
      )
      .run(projectId, now, now)
    for (const name of [
      '0002_milestone_3_product_model.sql',
      '0003_milestone_4_tasks.sql',
      '0004_milestones_5_6_delivery.sql',
      '0005_multi_repository_projects.sql',
      '0006_managed_project_directories.sql',
    ]) {
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    database
      .prepare(
        `UPDATE worker_model_bindings SET provider = 'openai', model = 'design-model'
         WHERE project_id = ? AND worker_type_kind = 'project_manager' AND slot = 'planning'`,
      )
      .run(projectId)
    database
      .prepare(
        `INSERT INTO tasks(
           id, project_id, title, status, queue_phase, worker_type_kind, formula_name,
           source, created_at, updated_at
         ) VALUES
           ('task_queue', ?, 'Queued', 'queue', 'ready', 'software_engineer',
            'software-delivery', 'user', ?, ?),
           ('task_active', ?, 'Active', 'in_progress', NULL, 'software_engineer',
            'software-delivery', 'user', ?, ?)`,
      )
      .run(projectId, now, now, projectId, now, now)
    database
      .prepare(
        `INSERT INTO task_runs(
           id, project_id, task_id, kind, city_name, rig_name, formula_name,
           formula_version, starting_event_cursor, request_id, status, stage,
           created_at, updated_at
         ) VALUES (
           'run_active', ?, 'task_active', 'implementation', 'factoru', 'legacy-rig',
           'software-delivery', '0.3.0', 0, 'legacy-request', 'running',
           'implementation', ?, ?
         )`,
      )
      .run(projectId, now, now)
    fs.copyFileSync(
      new URL('../migrations/0007_blueprint_workflow_catalog.sql', import.meta.url),
      path.join(directory, '0007_blueprint_workflow_catalog.sql'),
    )
    applyMigrations(database, directory)

    expect(
      database.prepare('SELECT * FROM factory_settings WHERE project_id = ?').get(projectId),
    ).toMatchObject({
      template_version: 2,
      blueprint_id: 'standard-software-project',
      default_workflow_preset_id: 'standard-build',
    })
    expect(
      database
        .prepare(
          `SELECT provider, model FROM worker_model_bindings
           WHERE project_id = ? AND worker_type_kind = 'software_engineer' AND slot = 'design'`,
        )
        .get(projectId),
    ).toEqual({ provider: 'openai', model: 'design-model' })
    expect(database.prepare('SELECT * FROM tasks WHERE id = ?').get('task_queue')).toMatchObject({
      workflow_preset_id: 'standard-build',
      formula_name: 'standard-build',
      queue_phase: 'awaiting_triage',
    })
    expect(
      database.prepare('SELECT * FROM task_runs WHERE id = ?').get('run_active'),
    ).toMatchObject({
      formula_name: 'software-delivery',
      workflow_preset_id: 'fast-patch',
      blueprint_id: 'standard-software-project',
      pack_lock_digest: 'legacy:factoru-default@0.3.0',
    })
    database.close()
  })

  it('resets active usage for SSE replay and only labels terminal history partial', () => {
    const { directory, database } = fixture()
    for (let version = 1; version <= 12; version += 1) {
      const prefix = String(version).padStart(4, '0')
      const name = fs
        .readdirSync(new URL('../migrations', import.meta.url))
        .find((candidate) => candidate.startsWith(`${prefix}_`))!
      fs.copyFileSync(new URL(`../migrations/${name}`, import.meta.url), path.join(directory, name))
    }
    applyMigrations(database, directory)
    const projectId = 'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const now = '2026-08-13T10:00:00.000Z'
    database
      .prepare(
        `INSERT INTO projects(
           id, name, repository_root_id, repository_relative_path, repository_real_path,
           default_branch, setup_state, created_at, updated_at
         ) VALUES (?, 'Usage migration', 'root', 'usage', '/repos/usage', 'dev', 'ready', ?, ?)`,
      )
      .run(projectId, now, now)
    database
      .prepare(
        `INSERT INTO tasks(id, project_id, title, status, source, created_at, updated_at)
         VALUES ('task_active', ?, 'Active', 'in_progress', 'user', ?, ?),
                ('task_done', ?, 'Done', 'backlog', 'user', ?, ?)`,
      )
      .run(projectId, now, now, projectId, now, now)
    database
      .prepare(
        `INSERT INTO task_runs(
           id, project_id, task_id, kind, city_name, rig_name, formula_name,
           starting_event_cursor, gas_city_event_cursor, request_id, status, stage,
           usage_json, created_at, updated_at
         ) VALUES
           ('run_active', ?, 'task_active', 'implementation', 'factoru', 'rig', 'software-delivery',
            10, 400, 'active-request', 'running', 'implementation', ?, ?, ?),
           ('run_done', ?, 'task_done', 'implementation', 'factoru', 'rig', 'software-delivery',
            20, 500, 'done-request', 'completed', 'needs_you', ?, ?, ?)`,
      )
      .run(
        projectId,
        JSON.stringify({
          inputTokens: 50,
          outputTokens: 10,
          estimatedCostUsd: 0.1,
          pricing: 'priced',
        }),
        now,
        now,
        projectId,
        JSON.stringify({
          inputTokens: 70,
          outputTokens: 20,
          estimatedCostUsd: 0.2,
          pricing: 'priced',
        }),
        now,
        now,
      )
    database.prepare('UPDATE task_runs SET review_package_json = ? WHERE id = ?').run(
      JSON.stringify({
        request: 'Usage migration',
        usage: {
          inputTokens: 70,
          outputTokens: 20,
          estimatedCostUsd: 0.2,
          pricing: 'priced',
        },
      }),
      'run_done',
    )
    fs.copyFileSync(
      new URL('../migrations/0013_gas_city_usage_stream.sql', import.meta.url),
      path.join(directory, '0013_gas_city_usage_stream.sql'),
    )
    applyMigrations(database, directory)

    const active = database
      .prepare('SELECT gas_city_event_cursor, usage_json FROM task_runs WHERE id = ?')
      .get('run_active') as { gas_city_event_cursor: number; usage_json: string }
    expect(active.gas_city_event_cursor).toBe(10)
    expect(JSON.parse(active.usage_json)).toMatchObject({ inputTokens: 0, partial: true })
    const done = database
      .prepare(
        'SELECT gas_city_event_cursor, usage_json, review_package_json FROM task_runs WHERE id = ?',
      )
      .get('run_done') as {
      gas_city_event_cursor: number
      usage_json: string
      review_package_json: string
    }
    expect(done.gas_city_event_cursor).toBe(500)
    expect(JSON.parse(done.usage_json)).toMatchObject({ inputTokens: 70, partial: true })
    expect(JSON.parse(done.review_package_json)).toMatchObject({ usage: { partial: true } })
    database.close()
  })
})
