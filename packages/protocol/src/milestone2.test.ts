import { describe, expect, it } from 'vitest'
import {
  deviceRevokeParamsSchema,
  localEnrollmentDescriptorSchema,
  localEnrollmentRequestSchema,
  liveRequestSchema,
  pairingExchangeRequestSchema,
  projectSnapshotSchema,
  projectCreateParamsSchema,
  projectSchema,
  repositoryAccessCheckParamsSchema,
  repositoryAccessCheckSchema,
} from './milestone2.js'

describe('Milestone 2 protocol', () => {
  it('accepts a formatted pairing code and rejects ambiguous characters', () => {
    expect(
      pairingExchangeRequestSchema.safeParse({ code: 'ABCD-EFGH-JKMN', deviceName: 'Mac' }).success,
    ).toBe(true)
    expect(
      pairingExchangeRequestSchema.safeParse({ code: 'ABCI-EFGH-JKMN', deviceName: 'Mac' }).success,
    ).toBe(false)
  })

  it('validates a loopback-only local enrollment descriptor and proof', () => {
    const proof = 'a'.repeat(43)
    expect(localEnrollmentRequestSchema.parse({ proof, deviceName: 'My Mac' })).toEqual({
      proof,
      deviceName: 'My Mac',
    })
    expect(
      localEnrollmentDescriptorSchema.safeParse({
        version: 1,
        serverId: 'srv_11111111111111111111111111111111',
        serverUrl: 'http://127.0.0.1:8787',
        proof,
      }).success,
    ).toBe(true)
    expect(
      localEnrollmentDescriptorSchema.safeParse({
        version: 1,
        serverId: 'srv_11111111111111111111111111111111',
        serverUrl: 'https://factoru.example.com',
        proof,
      }).success,
    ).toBe(false)
  })

  it('requires self-revocation confirmation to be explicit', () => {
    expect(deviceRevokeParamsSchema.parse({ deviceId: 'dev_one' }).confirmSelf).toBe(false)
    expect(
      deviceRevokeParamsSchema.parse({ deviceId: 'dev_one', confirmSelf: true }).confirmSelf,
    ).toBe(true)
  })

  it('requires command identifiers separately from query payloads', () => {
    expect(
      liveRequestSchema.parse({
        id: '1',
        method: 'projects.create',
        params: {},
        commandId: 'cmd_1',
      }).commandId,
    ).toBe('cmd_1')
  })

  it('validates an empty cursor snapshot', () => {
    expect(
      projectSnapshotSchema.parse({ projects: [], cursor: 0, resynchronized: false, events: [] }),
    ).toEqual({
      projects: [],
      cursor: 0,
      resynchronized: false,
      events: [],
    })
  })

  it('requires a named project with one or more local or remote repositories', () => {
    const parsed = projectCreateParamsSchema.parse({
      name: 'Product',
      repositories: [
        {
          kind: 'local',
          rootId: 'root_local',
          relativePath: 'web',
          defaultBranch: 'main',
          fingerprint: 'a'.repeat(64),
        },
        {
          kind: 'remote',
          url: 'https://example.com/api.git',
        },
      ],
    })
    expect(parsed.repositories).toHaveLength(2)
    expect(projectCreateParamsSchema.safeParse({ name: 'Empty', repositories: [] }).success).toBe(
      false,
    )
  })

  it('defaults the managed directory for cached projects from older servers', () => {
    expect(
      projectSchema.parse({
        id: 'prj_one',
        name: 'Legacy',
        description: null,
        repository: { rootId: 'root_one', relativePath: 'legacy', label: 'Repositories' },
        defaultBranch: 'main',
        setupState: 'ready',
        setupError: null,
        version: 1,
        createdAt: '2026-08-12T10:00:00.000Z',
        updatedAt: '2026-08-12T10:00:00.000Z',
        rig: {
          rigName: 'legacy',
          beadPrefix: 'leg',
          registrationState: 'ready',
          lastReconciledAt: null,
          error: null,
        },
        repositories: [
          {
            id: 'repo_one',
            isPrimary: true,
            sourceUrl: null,
            repository: { rootId: 'root_one', relativePath: 'legacy', label: 'Repositories' },
            defaultBranch: 'main',
            rig: {
              rigName: 'legacy',
              beadPrefix: 'leg',
              registrationState: 'ready',
              lastReconciledAt: null,
              error: null,
            },
          },
        ],
      }).projectDirectory,
    ).toBeNull()
  })

  it('validates remote repository access requests and successful results', () => {
    expect(
      repositoryAccessCheckParamsSchema.parse({ url: ' git@github-work:RUverse/factoru.git ' }),
    ).toEqual({ url: 'git@github-work:RUverse/factoru.git' })
    expect(
      repositoryAccessCheckSchema.parse({
        transport: 'ssh',
        host: 'github-work',
        accessible: true,
      }),
    ).toEqual({ transport: 'ssh', host: 'github-work', accessible: true })
  })
})
