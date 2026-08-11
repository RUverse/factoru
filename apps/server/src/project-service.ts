import { createHash, randomUUID } from 'node:crypto'
import type { FactoruDatabase, ProjectRecord, TrustedDevice } from '@factoru/database'
import type { Project, ProjectRepositoryInput, ProjectSnapshot } from '@factoru/protocol'
import { GasCityError, type RigRegistrar } from '@factoru/gas-city'
import { RepositoryError, type RepositoryService, type ResolvedRepository } from './repositories.js'

export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}

export interface ProjectServiceOptions {
  database: FactoruDatabase
  repositories: RepositoryService
  registrar: RigRegistrar
  cityName: string
  cityPath: string
}

export class ProjectService {
  readonly database: FactoruDatabase
  readonly repositories: RepositoryService
  readonly #registrar: RigRegistrar
  readonly #cityName: string
  readonly #cityPath: string

  constructor(options: ProjectServiceOptions) {
    this.database = options.database
    this.repositories = options.repositories
    this.#registrar = options.registrar
    this.#cityName = options.cityName
    this.#cityPath = options.cityPath
    this.database.recoverUnfinishedOutbox()
  }

  publicProject(record: ProjectRecord): Project {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      repository: {
        rootId: record.repositoryRootId,
        relativePath: record.repositoryRelativePath,
        label: this.repositories.rootLabel(record.repositoryRootId),
      },
      defaultBranch: record.defaultBranch,
      setupState: record.setupState,
      setupError:
        record.setupErrorCode && record.setupErrorMessage
          ? { code: record.setupErrorCode, message: record.setupErrorMessage }
          : null,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      rig: {
        rigName: record.rig.rigName,
        beadPrefix: record.rig.beadPrefix,
        registrationState: record.rig.registrationState,
        lastReconciledAt: record.rig.lastReconciledAt,
        error:
          record.rig.lastErrorCode && record.rig.lastErrorMessage
            ? { code: record.rig.lastErrorCode, message: record.rig.lastErrorMessage }
            : null,
      },
      repositories: record.repositories.map((repository) => ({
        id: repository.id,
        isPrimary: repository.isPrimary,
        sourceUrl: repository.sourceUrl,
        repository: {
          rootId: repository.repositoryRootId,
          relativePath: repository.repositoryRelativePath,
          label: this.repositories.rootLabel(repository.repositoryRootId),
        },
        defaultBranch: repository.defaultBranch,
        rig: {
          rigName: repository.rig.rigName,
          beadPrefix: repository.rig.beadPrefix,
          registrationState: repository.rig.registrationState,
          lastReconciledAt: repository.rig.lastReconciledAt,
          error:
            repository.rig.lastErrorCode && repository.rig.lastErrorMessage
              ? {
                  code: repository.rig.lastErrorCode,
                  message: repository.rig.lastErrorMessage,
                }
              : null,
        },
      })),
    }
  }

  listProjects(): Project[] {
    return this.database.listProjects().map((project) => this.publicProject(project))
  }

  getProject(id: string): Project {
    const project = this.database.getProject(id)
    if (!project) throw new ApplicationError('not_found', 'Project not found')
    return this.publicProject(project)
  }

  async createProject(
    device: TrustedDevice,
    commandId: string,
    params: {
      name: string
      description?: string
      repositories: ProjectRepositoryInput[]
    },
  ): Promise<Project> {
    const requestHash = createHash('sha256').update(JSON.stringify(params)).digest('hex')
    try {
      const replay = this.database.replayProjectCommand(commandId, 'projects.create', requestHash)
      if (replay) return this.publicProject(replay)
    } catch (error) {
      if (error instanceof Error && error.message === 'command_id_conflict') {
        throw new ApplicationError(
          'command_id_conflict',
          'Command ID was already used for another request',
        )
      }
      throw error
    }
    const prepared: Array<{
      repository: ResolvedRepository
      sourceUrl: string | null
      defaultBranch: string
    }> = []
    for (const source of params.repositories) {
      if (source.kind === 'remote') {
        const planned = this.repositories.planClone(source.url, source.rootId)
        if (
          prepared.some(
            (candidate) => candidate.repository.realPath === planned.repository.realPath,
          )
        ) {
          throw new ApplicationError(
            'duplicate_project_repository',
            'Each repository can be added to a project only once',
          )
        }
        const duplicate = this.database.findProjectByRepository(planned.repository.realPath)
        if (duplicate) {
          throw new ApplicationError(
            'project_already_exists',
            'This repository already belongs to a project',
            { projectId: duplicate.id },
          )
        }
        prepared.push({
          repository: planned.repository,
          sourceUrl: planned.sourceUrl,
          defaultBranch: 'HEAD',
        })
        continue
      }
      const { preview, repository } = await this.repositories.preview(
        source.rootId,
        source.relativePath,
        source.defaultBranch,
      )
      if (preview.fingerprint !== source.fingerprint) {
        throw new ApplicationError('preview_stale', 'Repository state changed; preview it again')
      }
      if (!preview.safe) {
        throw new ApplicationError(
          'repository_index_dirty',
          preview.blockedReason ?? 'Repository index is not clean',
        )
      }
      if (prepared.some((candidate) => candidate.repository.realPath === repository.realPath)) {
        throw new ApplicationError(
          'duplicate_project_repository',
          'Each repository can be added to a project only once',
        )
      }
      const duplicate = this.database.findProjectByRepository(repository.realPath)
      if (duplicate) {
        throw new ApplicationError(
          'project_already_exists',
          'This repository already belongs to a project',
          { projectId: duplicate.id },
        )
      }
      prepared.push({
        repository,
        sourceUrl: null,
        defaultBranch: preview.defaultBranch,
      })
    }
    const remoteUrls = [
      ...new Set(
        prepared.flatMap((candidate) => (candidate.sourceUrl ? [candidate.sourceUrl] : [])),
      ),
    ]
    await this.#checkRemoteAccess(remoteUrls)
    const projectId = `prj_${randomUUID().replaceAll('-', '')}`
    const short = projectId.slice(4, 16)
    const repositoryInputs = prepared.map((candidate, index) => {
      const discriminator = index === 0 ? '' : `-${index + 1}`
      return {
        id: `repo_${randomUUID().replaceAll('-', '')}`,
        isPrimary: index === 0,
        sourceUrl: candidate.sourceUrl ?? undefined,
        repositoryRootId: candidate.repository.root.id,
        repositoryRelativePath: candidate.repository.relativePath,
        repositoryRealPath: candidate.repository.realPath,
        defaultBranch: candidate.defaultBranch,
        cityName: this.#cityName,
        rigName: `factoru-${short}${discriminator}`,
        beadPrefix: `f${short.slice(0, 6)}${index.toString(36)}`,
      }
    })
    const primary = repositoryInputs[0]!
    try {
      return this.publicProject(
        this.database.createProject({
          commandId,
          deviceId: device.id,
          requestHash,
          projectId,
          name: params.name,
          description: params.description,
          repositoryRootId: primary.repositoryRootId,
          repositoryRelativePath: primary.repositoryRelativePath,
          repositoryRealPath: primary.repositoryRealPath,
          defaultBranch: primary.defaultBranch,
          cityName: this.#cityName,
          rigName: primary.rigName,
          beadPrefix: primary.beadPrefix,
          repositories: repositoryInputs,
        }),
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'command_id_conflict') {
        throw new ApplicationError(
          'command_id_conflict',
          'Command ID was already used for another request',
        )
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        const existing = prepared
          .map((candidate) => this.database.findProjectByRepository(candidate.repository.realPath))
          .find((candidate) => candidate !== null)
        throw new ApplicationError(
          'project_already_exists',
          'This repository already belongs to a project',
          existing ? { projectId: existing.id } : undefined,
        )
      }
      throw error
    }
  }

  async retrySetup(device: TrustedDevice, commandId: string, projectId: string): Promise<Project> {
    const current = this.database.getProject(projectId)
    if (!current) throw new ApplicationError('not_found', 'Project not found')
    if (current.setupState !== 'needs_attention') {
      throw new ApplicationError(
        'invalid_project_state',
        'Only projects needing attention can be retried',
      )
    }
    await this.#checkRemoteAccess([
      ...new Set(
        current.repositories.flatMap((repository) =>
          repository.rig.registrationState === 'failed' && repository.sourceUrl
            ? [repository.sourceUrl]
            : [],
        ),
      ),
    ])
    try {
      return this.publicProject(this.database.retryProjectSetup(commandId, device.id, projectId))
    } catch (error) {
      if (error instanceof Error && error.message === 'not_found') {
        throw new ApplicationError('not_found', 'Project not found')
      }
      if (error instanceof Error && error.message === 'invalid_project_state') {
        throw new ApplicationError(
          'invalid_project_state',
          'Only projects needing attention can be retried',
        )
      }
      if (error instanceof Error && error.message === 'command_id_conflict') {
        throw new ApplicationError(
          'command_id_conflict',
          'Command ID was already used for another request',
        )
      }
      throw error
    }
  }

  async #checkRemoteAccess(sourceUrls: readonly string[]): Promise<void> {
    for (let index = 0; index < sourceUrls.length; index += 4) {
      await Promise.all(
        sourceUrls
          .slice(index, index + 4)
          .map((sourceUrl) => this.repositories.checkRemoteAccess(sourceUrl)),
      )
    }
  }

  snapshot(afterCursor: number): ProjectSnapshot {
    return this.database.connection.transaction(() => {
      const events = this.database.eventsAfter(afterCursor, 501)
      const resynchronized = events.length > 500
      return {
        projects: this.listProjects(),
        cursor: this.database.currentSequence(),
        resynchronized,
        events: resynchronized
          ? []
          : events.map((event) => ({
              sequence: event.sequence,
              eventId: event.eventId,
              type: event.type,
              projectId: event.aggregateId,
              projectVersion: event.aggregateVersion,
              payload: event.payload,
              occurredAt: event.occurredAt,
            })),
      }
    })()
  }

  async processOutbox(): Promise<Project[]> {
    const changed: Project[] = []
    for (const item of this.database.claimDueOutbox()) {
      const project = this.database.getProject(item.projectId)
      if (!project) continue
      let repository = item.repositoryId
        ? project.repositories.find((candidate) => candidate.id === item.repositoryId)
        : project.repositories.find((candidate) => candidate.isPrimary)
      if (!repository) continue
      try {
        if (repository.sourceUrl) {
          const repositoryId = repository.id
          const imported = await this.repositories.clone(
            repository.sourceUrl,
            repository.repositoryRootId,
          )
          const { preview } = await this.repositories.preview(
            imported.repository.root.id,
            imported.repository.relativePath,
          )
          if (!preview.safe) {
            throw new RepositoryError(
              'repository_index_dirty',
              preview.blockedReason ?? 'Cloned repository index is not clean',
            )
          }
          const materialized = this.database.materializeProjectRepository(
            project.id,
            repositoryId,
            preview.defaultBranch,
          )
          repository = materialized.repositories.find((candidate) => candidate.id === repositoryId)!
        }
        await this.#registrar.register({
          cityPath: this.#cityPath,
          repositoryPath: repository.repositoryRealPath,
          rigName: repository.rig.rigName,
          beadPrefix: repository.rig.beadPrefix,
          defaultBranch: repository.defaultBranch,
        })
        changed.push(
          this.publicProject(
            this.database.completeProvisioning(item.id, project.id, repository.id),
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        changed.push(
          this.publicProject(
            this.database.failProvisioning(
              item.id,
              project.id,
              error instanceof GasCityError && !error.retryable ? 6 : item.attemptCount,
              error instanceof RepositoryError ? error.code : 'gas_city_registration_failed',
              message,
              repository.id,
            ),
          ),
        )
      }
    }
    return changed
  }
}
