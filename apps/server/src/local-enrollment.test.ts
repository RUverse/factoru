import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseServerId } from '@factoru/domain'
import { localEnrollmentDescriptorSchema } from '@factoru/protocol'
import { writeLocalEnrollmentFile } from './local-enrollment.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('local enrollment file', () => {
  it('writes a private restart-scoped loopback descriptor', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-local-enrollment-'))
    directories.push(directory)
    const file = path.join(directory, 'nested', 'local-enrollment.json')
    const first = writeLocalEnrollmentFile(file, {
      serverId: parseServerId('srv_11111111111111111111111111111111'),
      serverUrl: 'http://127.0.0.1:8787',
    })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(
      localEnrollmentDescriptorSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))),
    ).toEqual(first)
    const second = writeLocalEnrollmentFile(file, {
      serverId: parseServerId('srv_11111111111111111111111111111111'),
      serverUrl: 'http://127.0.0.1:8787',
    })
    expect(second.proof).not.toBe(first.proof)
  })
})
