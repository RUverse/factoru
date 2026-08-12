import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ArtifactRecord, FactoruDatabase } from '@factoru/database'
import { MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, imageMimeTypeSchema } from '@factoru/protocol'
import { ApplicationError } from './project-service.js'

export const PROJECT_ARTIFACT_QUOTA_BYTES = 256 * 1024 * 1024
export const ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16)
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function gifDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    return null
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  const sof = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  while (offset + 4 <= bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (sof.has(marker) && length >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  return null
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  )
    return null
  const kind = bytes.toString('ascii', 12, 16)
  if (kind === 'VP8X') {
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
  }
  if (
    kind === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return null
}

export function inspectImage(
  bytes: Buffer,
  claimedMimeType: string,
): { mimeType: ArtifactRecord['mimeType']; width: number; height: number } {
  const parsedMime = imageMimeTypeSchema.safeParse(claimedMimeType.toLowerCase())
  if (!parsedMime.success) {
    throw new ApplicationError('unsupported_image_type', 'Use a PNG, JPEG, GIF, or WebP image')
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ApplicationError(
      'image_size_limit',
      `Images must be between 1 byte and ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    )
  }
  const dimensions =
    parsedMime.data === 'image/png'
      ? pngDimensions(bytes)
      : parsedMime.data === 'image/jpeg'
        ? jpegDimensions(bytes)
        : parsedMime.data === 'image/gif'
          ? gifDimensions(bytes)
          : webpDimensions(bytes)
  if (!dimensions) {
    throw new ApplicationError(
      'image_signature_mismatch',
      'The file contents do not match the declared image type',
    )
  }
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION
  ) {
    throw new ApplicationError(
      'image_dimension_limit',
      `Image dimensions must not exceed ${MAX_IMAGE_DIMENSION} × ${MAX_IMAGE_DIMENSION}`,
    )
  }
  return { mimeType: parsedMime.data, ...dimensions }
}

function safeFileName(value: string): string {
  const name = [...path.basename(value)]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
  return (name || 'image').slice(0, 255)
}

export class ArtifactService {
  readonly #database: FactoruDatabase
  readonly #root: string
  readonly #now: () => Date

  constructor(database: FactoruDatabase, root: string, now: () => Date = () => new Date()) {
    this.#database = database
    this.#root = path.resolve(root)
    this.#now = now
    if (fs.existsSync(this.#root) && fs.lstatSync(this.#root).isSymbolicLink()) {
      throw new Error('artifact_storage_root_must_not_be_a_link')
    }
    fs.mkdirSync(this.#root, { recursive: true, mode: 0o700 })
    const resolvedParent = fs.realpathSync(path.dirname(this.#root))
    const expectedRoot = path.join(resolvedParent, path.basename(this.#root))
    if (fs.realpathSync(this.#root) !== expectedRoot) {
      throw new Error('artifact_storage_root_must_resolve_to_itself')
    }
    fs.chmodSync(this.#root, 0o700)
  }

  upload(input: {
    projectId: string
    conversationId: string
    deviceId: string
    fileName: string
    mimeType: string
    provenance: 'picker' | 'paste' | 'drop'
    bytes: Buffer
  }): ArtifactRecord {
    const conversation = this.#database.product.getConversationById(input.conversationId)
    if (!conversation || conversation.projectId !== input.projectId) {
      throw new ApplicationError('not_found', 'Conversation not found')
    }
    const inspected = inspectImage(input.bytes, input.mimeType)
    if (
      this.#database.conversations.artifactBytesInProject(input.projectId) + input.bytes.length >
      PROJECT_ARTIFACT_QUOTA_BYTES
    ) {
      throw new ApplicationError(
        'artifact_quota_exceeded',
        'This project has reached its 256 MB image quota; remove unused images and retry',
      )
    }
    const key = `${randomUUID().replaceAll('-', '')}.bin`
    const destination = this.#pathForKey(key)
    const temporary = `${destination}.${randomUUID()}.upload`
    fs.writeFileSync(temporary, input.bytes, { flag: 'wx', mode: 0o600 })
    try {
      fs.renameSync(temporary, destination)
      return this.#database.conversations.createArtifact({
        projectId: input.projectId,
        conversationId: input.conversationId,
        createdByDeviceId: input.deviceId,
        fileName: safeFileName(input.fileName),
        storageKey: key,
        contentHash: createHash('sha256').update(input.bytes).digest('hex'),
        ...inspected,
        sizeBytes: input.bytes.length,
        provenance: input.provenance,
        retentionExpiresAt: new Date(this.#now().getTime() + ARTIFACT_RETENTION_MS).toISOString(),
      })
    } catch (error) {
      try {
        fs.unlinkSync(destination)
      } catch {
        /* preserve the original failure */
      }
      try {
        fs.unlinkSync(temporary)
      } catch {
        /* preserve the original failure */
      }
      throw error
    }
  }

  readScoped(
    projectId: string,
    conversationId: string,
    artifactId: string,
  ): {
    artifact: ArtifactRecord
    bytes: Buffer
  } {
    const artifact = this.#database.conversations.getArtifact(artifactId)
    if (
      !artifact ||
      artifact.status !== 'ready' ||
      artifact.projectId !== projectId ||
      artifact.conversationId !== conversationId
    )
      throw new ApplicationError('not_found', 'Image not found')
    return { artifact, bytes: fs.readFileSync(this.#pathForKey(artifact.storageKey)) }
  }

  readWithGrant(artifactId: string, token: string): { artifact: ArtifactRecord; bytes: Buffer } {
    const artifact = this.#database.conversations.consumeDeliveryGrant(artifactId, token)
    if (!artifact || artifact.status !== 'ready') {
      throw new ApplicationError('not_found', 'Image delivery grant is invalid or expired')
    }
    return { artifact, bytes: fs.readFileSync(this.#pathForKey(artifact.storageKey)) }
  }

  attachmentUrl(artifactId: string, serverOrigin: string): string {
    const artifact = this.#database.conversations.getArtifact(artifactId)
    if (!artifact || artifact.status !== 'ready')
      throw new ApplicationError('not_found', 'Image not found')
    const grant = this.#database.conversations.createDeliveryGrant(artifactId)
    const url = new URL(`/internal/v1/artifacts/${encodeURIComponent(artifactId)}`, serverOrigin)
    url.searchParams.set('token', grant.token)
    return url.toString()
  }

  remove(projectId: string, conversationId: string, artifactId: string): void {
    const artifact = this.readScoped(projectId, conversationId, artifactId).artifact
    const deleted = this.#database.conversations.markArtifactDeleted(artifact.id)
    if (!deleted || deleted.status !== 'deleted') {
      throw new ApplicationError(
        'artifact_in_use',
        'An image attached to a message cannot be removed',
      )
    }
    fs.unlinkSync(this.#pathForKey(artifact.storageKey))
  }

  cleanup(): number {
    this.#database.conversations.deleteExpiredDeliveryGrants()
    let removed = 0
    for (const artifact of this.#database.conversations.expiredUnreferencedArtifacts()) {
      const deleted = this.#database.conversations.markArtifactDeleted(artifact.id)
      if (!deleted || deleted.status !== 'deleted') continue
      try {
        fs.unlinkSync(this.#pathForKey(artifact.storageKey))
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      removed += 1
    }
    return removed
  }

  #pathForKey(key: string): string {
    if (!/^[0-9a-f]{32}\.bin$/.test(key)) throw new Error('invalid_artifact_storage_key')
    const result = path.resolve(this.#root, key)
    if (path.dirname(result) !== this.#root) throw new Error('invalid_artifact_storage_path')
    return result
  }
}
