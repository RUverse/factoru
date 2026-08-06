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
})
