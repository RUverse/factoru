import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const MIGRATION_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/

function migrationsDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations')
}

export function applyMigrations(db: Database.Database, directory = migrationsDirectory()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  const files = fs
    .readdirSync(directory)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort()
  const available = files.map((name) => ({
    name,
    version: Number(MIGRATION_PATTERN.exec(name)![1]),
  }))
  const newestAvailable = available.at(-1)?.version ?? 0
  const newestApplied = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM migrations')
    .get() as { version: number }

  if (newestApplied.version > newestAvailable) {
    throw new Error(
      `Database schema version ${newestApplied.version} is newer than this Factoru binary (${newestAvailable})`,
    )
  }

  const migrate = db.transaction((migration: (typeof available)[number]) => {
    const sql = fs.readFileSync(path.join(directory, migration.name), 'utf8')
    db.exec(sql)
    db.prepare('INSERT INTO migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
      migration.version,
      migration.name,
      new Date().toISOString(),
    )
  })

  for (const migration of available) {
    const exists = db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(migration.version)
    if (!exists) migrate(migration)
  }
}
