import { createHash, randomUUID } from 'node:crypto'
import type { FactoruDatabase, ProjectRecord, TrustedDevice } from '@factoru/database'
import type { Project, ProjectSnapshot } from '@factoru/protocol'
import { GasCityError, type RigRegistrar } from '@factoru/gas-city'
import { RepositoryError, type RepositoryService } from './repositories.js'

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
      rootId: string
      relativePath: string
      name: string
      description?: string
      defaultBranch: string
      fingerprint: string
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
    const { preview, repository } = await this.repositories.preview(
      params.rootId,
      params.relativePath,
      params.defaultBranch,
    )
    if (preview.fingerprint !== params.fingerprint) {
      throw new ApplicationError('preview_stale', 'Repository state changed; preview it again')
    }
    if (!preview.safe) {
      throw new ApplicationError(
        'repository_index_dirty',
        preview.blockedReason ?? 'Repository index is not clean',
      )
    }
    const duplicate = this.database.findProjectByRepository(repository.realPath)
    if (duplicate) {
      throw new ApplicationError(
        'project_already_exists',
        'This repository already belongs to a project',
        {
          projectId: duplicate.id,
        },
      )
    }
    const projectId = `prj_${randomUUID().replaceAll('-', '')}`
    const short = projectId.slice(4, 16)
    try {
      return this.publicProject(
        this.database.createProject({
          commandId,
          deviceId: device.id,
          requestHash,
          projectId,
          name: params.name,
          description: params.description,
          repositoryRootId: repository.root.id,
          repositoryRelativePath: repository.relativePath,
          repositoryRealPath: repository.realPath,
          defaultBranch: params.defaultBranch,
          cityName: this.#cityName,
          rigName: `factoru-${short}`,
          beadPrefix: `f${short.slice(0, 7)}`,
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
        const existing = this.database.findProjectByRepository(repository.realPath)
        throw new ApplicationError(
          'project_already_exists',
          'This repository already belongs to a project',
          existing ? { projectId: existing.id } : undefined,
        )
      }
      throw error
    }
  }

  retrySetup(device: TrustedDevice, commandId: string, projectId: string): Project {
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
      try {
        await this.#registrar.register({
          cityPath: this.#cityPath,
          repositoryPath: project.repositoryRealPath,
          rigName: project.rig.rigName,
          beadPrefix: project.rig.beadPrefix,
          defaultBranch: project.defaultBranch,
        })
        changed.push(this.publicProject(this.database.completeProvisioning(item.id, project.id)))
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
            ),
          ),
        )
      }
    }
    return changed
  }
}
