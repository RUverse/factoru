import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLocalEnrollmentFile } from './local-enrollment'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('desktop local enrollment reader', () => {
  it('reads a private loopback descriptor', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-desktop-enrollment-'))
    directories.push(directory)
    const file = path.join(directory, 'local-enrollment.json')
    const descriptor = {
      version: 1,
      serverId: 'srv_11111111111111111111111111111111',
      serverUrl: 'http://127.0.0.1:32800',
      proof: 'a'.repeat(43),
    }
    fs.writeFileSync(file, JSON.stringify(descriptor), { mode: 0o600 })
    expect(await readLocalEnrollmentFile(file)).toEqual(descriptor)
  })

  it('explains when no local server enrollment exists', async () => {
    await expect(readLocalEnrollmentFile(undefined)).rejects.toThrow(/not running/)
  })

  it.runIf(process.platform !== 'win32')('rejects a world-readable proof', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-desktop-enrollment-'))
    directories.push(directory)
    const file = path.join(directory, 'local-enrollment.json')
    fs.writeFileSync(file, '{}', { mode: 0o644 })
    await expect(readLocalEnrollmentFile(file)).rejects.toThrow(/permissions/)
  })
})
