import fs from 'node:fs/promises'
import path from 'node:path'
import { localEnrollmentDescriptorSchema, type LocalEnrollmentDescriptor } from '@factoru/protocol'

const NOT_RUNNING_MESSAGE =
  'Factoru Server is not running on this device. Start the local server, then try again.'

export async function readLocalEnrollmentFile(
  file: string | undefined,
): Promise<LocalEnrollmentDescriptor> {
  if (!file?.trim()) throw new Error(NOT_RUNNING_MESSAGE)
  if (!path.isAbsolute(file)) throw new Error('Local server enrollment path is invalid')
  try {
    const stats = await fs.lstat(file)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Local server enrollment must be a regular file')
    }
    if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
      throw new Error('Local server enrollment file permissions are too broad')
    }
    return localEnrollmentDescriptorSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(NOT_RUNNING_MESSAGE, { cause: error })
    }
    throw error
  }
}
