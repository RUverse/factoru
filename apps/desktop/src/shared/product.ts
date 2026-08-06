import type { Project, ProjectPreview, TrustedDevice } from '@factoru/protocol'

export interface ServerProfileSummary {
  serverId: string
  deviceId: string
  name: string
  url: string
  createdAt: string
  lastConnectedAt: string | null
}

export interface ProductSnapshot {
  profiles: ServerProfileSummary[]
  activeServerId: string | null
  projects: Project[]
  connected: boolean
  cached: boolean
  error: string | null
}

export const IPC_PRODUCT_GET = 'factoru:product:get'
export const IPC_PRODUCT_PAIR = 'factoru:product:pair'
export const IPC_PRODUCT_ACTIVATE = 'factoru:product:activate'
export const IPC_PRODUCT_REMOVE = 'factoru:product:remove'
export const IPC_PRODUCT_RECONNECT = 'factoru:product:reconnect'
export const IPC_PRODUCT_ROOTS = 'factoru:product:roots'
export const IPC_PRODUCT_BROWSE = 'factoru:product:browse'
export const IPC_PRODUCT_PREVIEW = 'factoru:product:preview'
export const IPC_PRODUCT_CREATE = 'factoru:product:create'
export const IPC_PRODUCT_RETRY = 'factoru:product:retry'
export const IPC_PRODUCT_DEVICES = 'factoru:product:devices'
export const IPC_PRODUCT_REVOKE = 'factoru:product:revoke'
export const IPC_PRODUCT_CHANGED = 'factoru:product:changed'

export interface ProductBridge {
  get(): Promise<ProductSnapshot>
  pair(url: string, code: string, deviceName: string): Promise<ProductSnapshot>
  activate(serverId: string): Promise<ProductSnapshot>
  remove(serverId: string): Promise<ProductSnapshot>
  reconnect(): Promise<ProductSnapshot>
  roots(): Promise<Array<{ id: string; label: string }>>
  browse(
    rootId: string,
    relativePath: string,
  ): Promise<Array<{ name: string; relativePath: string; kind: 'directory' | 'repository' }>>
  preview(rootId: string, relativePath: string, defaultBranch?: string): Promise<ProjectPreview>
  create(params: {
    rootId: string
    relativePath: string
    name: string
    description?: string
    defaultBranch: string
    fingerprint: string
  }): Promise<Project>
  retry(projectId: string): Promise<unknown>
  devices(): Promise<TrustedDevice[]>
  revoke(deviceId: string): Promise<unknown>
  subscribe(listener: (snapshot: ProductSnapshot) => void): () => void
}
