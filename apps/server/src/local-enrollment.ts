import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { localEnrollmentDescriptorSchema, type LocalEnrollmentDescriptor } from '@factoru/protocol'
import type { ServerId } from '@factoru/domain'

export interface LocalEnrollmentFileInput {
  readonly serverId: ServerId
  readonly serverUrl: string
}

/**
 * Publishes a restart-scoped proof for same-user desktop enrollment. The file
 * is a private runtime capability, not durable Factoru product state.
 */
export function writeLocalEnrollmentFile(
  file: string,
  input: LocalEnrollmentFileInput,
): LocalEnrollmentDescriptor {
  if (!path.isAbsolute(file)) throw new Error('Local enrollment file path must be absolute')
  const descriptor = localEnrollmentDescriptorSchema.parse({
    version: 1,
    ...input,
    proof: randomBytes(32).toString('base64url'),
  })
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`)
  try {
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0)
    const fd = fs.openSync(temporary, flags, 0o600)
    try {
      fs.fchmodSync(fd, 0o600)
      fs.writeFileSync(fd, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, file)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  return descriptor
}
