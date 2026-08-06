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
})
