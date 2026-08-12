import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  ProjectPreview,
  RepositoryAccessCheck,
  ModelCatalog,
  Task,
  TrustedDevice,
  WorkerType,
} from '@factoru/protocol'
import type { ProductSnapshot, ServerProfileSummary } from '../../shared/product'
import {
  FACTORY_NAME_MAX_LENGTH,
  factoryAggregateStatus,
  factoryStatusLabel,
} from '../../shared/factory'
import { provisioningHeading, provisioningMessage } from './provisioning'

type Root = { id: string; label: string }
type Entry = { name: string; relativePath: string; kind: 'directory' | 'repository' }
type RepositoryDraft =
  | { id: string; kind: 'local'; preview: ProjectPreview }
  | {
      id: string
      kind: 'remote'
      url: string
      access: RepositoryAccessCheck
    }

const taskColumns = [
  ['backlog', 'Backlog'],
  ['queue', 'Queue'],
  ['in_progress', 'In progress'],
  ['needs_you', 'Needs you'],
] as const

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

function ModelBindingEditor({
  binding,
  catalog,
  connected,
  busy,
  onSave,
}: {
  binding: WorkerType['modelBindings'][number]
  catalog: ModelCatalog
  connected: boolean
  busy: boolean
  onSave: (provider: string | null, model: string | null) => void
}) {
  const configuredProviders = catalog.providers
  const currentProvider = binding.provider
    ? (configuredProviders.find((provider) => provider.id === binding.provider) ?? {
        id: binding.provider,
        name: `${binding.provider} (current)`,
        defaultModelId: binding.model,
        models: binding.model ? [{ id: binding.model, name: binding.model }] : [],
      })
    : null
  const providers = currentProvider
    ? [
        currentProvider,
        ...configuredProviders.filter((provider) => provider.id !== currentProvider.id),
      ]
    : configuredProviders
  const initialProviderId = binding.provider ?? (providers.length === 1 ? providers[0]!.id : '')
  const initialProvider = providers.find((provider) => provider.id === initialProviderId)
  const [providerId, setProviderId] = useState(initialProviderId)
  const [modelId, setModelId] = useState(
    binding.model ?? initialProvider?.defaultModelId ?? initialProvider?.models[0]?.id ?? '',
  )
  const selectedProvider = providers.find((provider) => provider.id === providerId)
  const models = selectedProvider?.models ?? []

  return (
    <form
      className="model-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (providerId && modelId) onSave(providerId, modelId)
        if (!providerId && binding.provider) onSave(null, null)
      }}
    >
      <strong>{statusLabel(binding.slot)}</strong>
      <select
        name="provider"
        aria-label={`${binding.slot} provider`}
        value={providerId}
        disabled={!connected || providers.length === 0}
        onChange={(event) => {
          const nextProviderId = event.currentTarget.value
          const nextProvider = providers.find((provider) => provider.id === nextProviderId)
          setProviderId(nextProviderId)
          setModelId(nextProvider?.defaultModelId ?? nextProvider?.models[0]?.id ?? '')
        }}
      >
        <option value="">Not assigned</option>
        {providers.map((provider) => (
          <option value={provider.id} key={provider.id}>
            {provider.name}
          </option>
        ))}
      </select>
      <select
        name="model"
        aria-label={`${binding.slot} model`}
        value={modelId}
        disabled={!connected || !selectedProvider || models.length === 0}
        onChange={(event) => setModelId(event.currentTarget.value)}
      >
        {!modelId && <option value="">Choose model</option>}
        {models.map((model) => (
          <option value={model.id} key={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      <button disabled={!connected || busy || (providerId ? !modelId : binding.provider === null)}>
        {!providerId && binding.provider ? 'Clear' : 'Save'}
      </button>
    </form>
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'tasks' | 'team'>('tasks')
  const [showPairing, setShowPairing] = useState(false)
  const [factorySwitcherOpen, setFactorySwitcherOpen] = useState(false)
  const [renamingFactoryId, setRenamingFactoryId] = useState<string | null>(null)
  const [factoryName, setFactoryName] = useState('')
  const [factoryFilterId, setFactoryFilterId] = useState<string | null>(null)
  const [managedFactoryId, setManagedFactoryId] = useState<string | null>(null)
  const [showProjectSetup, setShowProjectSetup] = useState(false)
  const [projectFactoryId, setProjectFactoryId] = useState('')
  const [connectionType, setConnectionType] = useState<'local' | 'remote'>('local')
  const [serverUrl, setServerUrl] = useState('https://')
  const [roots, setRoots] = useState<Root[]>([])
  const [rootId, setRootId] = useState('')
  const [directory, setDirectory] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [preview, setPreview] = useState<ProjectPreview | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectBlueprintId, setProjectBlueprintId] = useState<
    'standard-software-project' | 'fast-patch'
  >('standard-software-project')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [repositoryDrafts, setRepositoryDrafts] = useState<RepositoryDraft[]>([])
  const [checkingRepositoryAccess, setCheckingRepositoryAccess] = useState(false)
  const [repositoryAccessError, setRepositoryAccessError] = useState<string | null>(null)
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null)
  const [showServerBrowser, setShowServerBrowser] = useState(false)
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [showDevices, setShowDevices] = useState(false)
  const [deviceFactoryId, setDeviceFactoryId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.factoru.product.get().then((value) => active && setSnapshot(value))
    const unsubscribe = window.factoru.product.subscribe(setSnapshot)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const activeLocatedProject = useMemo(
    () =>
      snapshot?.projects.find(
        ({ ref }) =>
          ref.factoryId === snapshot.activeProjectRef?.factoryId &&
          ref.projectId === snapshot.activeProjectRef?.projectId,
      ) ?? null,
    [snapshot],
  )
  const activeProject = activeLocatedProject?.project ?? null
  const activeProjectRef = snapshot?.activeProjectRef ?? null
  const managedFactory = useMemo(
    () => snapshot?.profiles.find((profile) => profile.serverId === managedFactoryId) ?? null,
    [managedFactoryId, snapshot],
  )
  const deviceFactory = useMemo(
    () => snapshot?.profiles.find((profile) => profile.serverId === deviceFactoryId) ?? null,
    [deviceFactoryId, snapshot],
  )
  const projectFactory = useMemo(
    () => snapshot?.profiles.find((profile) => profile.serverId === projectFactoryId) ?? null,
    [projectFactoryId, snapshot],
  )
  const filteredProjects = useMemo(
    () =>
      snapshot?.projects.filter(
        ({ ref }) => factoryFilterId === null || ref.factoryId === factoryFilterId,
      ) ?? [],
    [factoryFilterId, snapshot],
  )
  const hasLocalFactory = snapshot?.profiles.some((profile) => profile.kind === 'local') ?? false
  const onlineFactoryCount =
    snapshot?.profiles.filter((profile) => profile.connectionState === 'connected').length ?? 0
  const factorySummary = factoryAggregateStatus(snapshot?.profiles ?? [])

  useEffect(() => {
    if (!factorySwitcherOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || renamingFactoryId) return
      setFactorySwitcherOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [factorySwitcherOpen, renamingFactoryId])

  const run = async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const pair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() =>
      window.factoru.product.pair(
        String(data.get('url')),
        String(data.get('code')).toUpperCase(),
        String(data.get('deviceName')),
        String(data.get('factoryName')),
      ),
    ).then((value) => {
      if (value) {
        setSnapshot(value)
        setShowPairing(false)
      }
    })
  }

  const pairLocal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() => window.factoru.product.pairLocal(String(data.get('deviceName')))).then(
      (value) => {
        if (value) {
          setSnapshot(value)
          setShowPairing(false)
        }
      },
    )
  }

  const completeRemoteFactoryIntro = (addRemote: boolean) => {
    void run(() => window.factoru.product.completeRemoteFactoryIntro()).then((value) => {
      if (!value) return
      setSnapshot(value)
      if (addRemote) {
        setConnectionType('remote')
        setShowPairing(true)
      }
    })
  }

  const selectFactory = (serverId: string | null) => {
    setFactoryFilterId(serverId)
    setManagedFactoryId(serverId)
    setFactorySwitcherOpen(false)
  }

  const renameFactory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renamingFactoryId) return
    void run(() => window.factoru.product.rename(renamingFactoryId, factoryName)).then((value) => {
      if (!value) return
      setSnapshot(value)
      setRenamingFactoryId(null)
      setFactoryName('')
    })
  }

  const reconnectFactory = (factoryId: string) => {
    void run(() => window.factoru.product.reconnect(factoryId)).then(
      (value) => value && setSnapshot(value),
    )
  }

  const openTrustedDevices = (factoryId: string) => {
    setDeviceFactoryId(factoryId)
    setShowDevices(true)
    setFactorySwitcherOpen(false)
    void run(() => window.factoru.product.devices(factoryId)).then(
      (value) => value && setDevices(value),
    )
  }

  const forgetFactory = (factory: ServerProfileSummary) => {
    if (
      !window.confirm(
        `Forget “${factory.name}” on this Desktop? Its local profile and credential will be removed. Projects and server data will not be changed.`,
      )
    ) {
      return
    }
    void run(() => window.factoru.product.remove(factory.serverId)).then((value) => {
      if (!value) return
      setSnapshot(value)
      if (factoryFilterId === factory.serverId) setFactoryFilterId(null)
      setFactorySwitcherOpen(value.profiles.length > 0)
      setRenamingFactoryId(null)
      setManagedFactoryId(null)
      setShowDevices(false)
      setDeviceFactoryId(null)
      setDevices([])
    })
  }

  const defaultProjectFactory = (): ServerProfileSummary | null => {
    const connected = snapshot?.profiles.filter(
      (profile) => profile.connectionState === 'connected',
    )
    return (
      connected?.find((profile) => profile.serverId === factoryFilterId) ??
      connected?.find((profile) => profile.kind === 'local') ??
      connected?.[0] ??
      null
    )
  }

  const loadFactoryRoots = async (factoryId: string) => {
    const loaded = await run(() => window.factoru.product.roots(factoryId))
    if (!loaded) return
    setRoots(loaded)
    const first = loaded[0]?.id ?? ''
    setRootId(first)
    setDirectory('')
    setEntries(
      first ? ((await run(() => window.factoru.product.browse(factoryId, first, ''))) ?? []) : [],
    )
  }

  const loadRoots = async () => {
    const factory = defaultProjectFactory()
    if (!factory) {
      setError('Connect a factory before creating a project.')
      return
    }
    setProjectFactoryId(factory.serverId)
    await loadFactoryRoots(factory.serverId)
    setProjectName('')
    setProjectDescription('')
    setRepositoryUrl('')
    setRepositoryDrafts([])
    setRepositoryAccessError(null)
    setProjectCreateError(null)
    setPreview(null)
    setShowServerBrowser(false)
    setShowProjectSetup(true)
  }

  const browse = async (nextRoot: string, nextDirectory: string) => {
    if (!projectFactoryId) return
    setRootId(nextRoot)
    setDirectory(nextDirectory)
    setPreview(null)
    setEntries(
      (await run(() => window.factoru.product.browse(projectFactoryId, nextRoot, nextDirectory))) ??
        [],
    )
  }

  const addPreview = (value: ProjectPreview) => {
    if (!value.safe) {
      setPreview(value)
      return
    }
    setRepositoryDrafts((current) => {
      if (
        current.some(
          (draft) =>
            draft.kind === 'local' &&
            draft.preview.rootId === value.rootId &&
            draft.preview.relativePath === value.relativePath,
        )
      ) {
        return current
      }
      return [
        ...current,
        { id: `local:${value.rootId}:${value.relativePath}`, kind: 'local', preview: value },
      ]
    })
    setProjectName((current) => current || value.suggestedName)
    setPreview(null)
  }

  const chooseRepositoryFolder = () => {
    if (!projectFactoryId) return
    void run(() => window.factoru.product.chooseRepositoryFolder(projectFactoryId)).then(
      (value) => {
        if (value) addPreview(value)
      },
    )
  }

  const changeProjectFactory = async (factoryId: string) => {
    if (factoryId === projectFactoryId) return
    if (
      repositoryDrafts.length > 0 &&
      !window.confirm(
        'Changing factories clears the repositories selected for this project. Continue?',
      )
    ) {
      return
    }
    setProjectFactoryId(factoryId)
    setRepositoryDrafts([])
    setRepositoryUrl('')
    setRepositoryAccessError(null)
    setProjectCreateError(null)
    setPreview(null)
    setShowServerBrowser(false)
    await loadFactoryRoots(factoryId)
  }

  const addRepositoryUrl = async () => {
    const url = repositoryUrl.trim()
    if (!url || !projectFactoryId || checkingRepositoryAccess) return
    if (repositoryDrafts.some((draft) => draft.kind === 'remote' && draft.url === url)) {
      setRepositoryUrl('')
      setRepositoryAccessError(null)
      return
    }
    setCheckingRepositoryAccess(true)
    setRepositoryAccessError(null)
    setProjectCreateError(null)
    let outcome
    try {
      outcome = await window.factoru.product.checkRepositoryAccess(projectFactoryId, url)
    } catch (caught) {
      setRepositoryAccessError(caught instanceof Error ? caught.message : String(caught))
      setCheckingRepositoryAccess(false)
      return
    }
    setCheckingRepositoryAccess(false)
    if (!outcome.ok) {
      setRepositoryAccessError(
        `${projectFactory?.name ?? 'The selected factory'} cannot access this repository. ${outcome.error.message}`,
      )
      return
    }
    setRepositoryDrafts((current) =>
      current.some((draft) => draft.kind === 'remote' && draft.url === url)
        ? current
        : [...current, { id: `remote:${url}`, kind: 'remote', url, access: outcome.result }],
    )
    if (!projectName) {
      const suggested =
        url
          .split('/')
          .at(-1)
          ?.replace(/\.git$/, '') ?? ''
      setProjectName(suggested)
    }
    setRepositoryUrl('')
  }

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (repositoryDrafts.length === 0 || projectFactory?.connectionState !== 'connected') return
    setBusy(true)
    setProjectCreateError(null)
    void window.factoru.product
      .create(projectFactoryId, {
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
        blueprintId: projectBlueprintId,
        repositories: repositoryDrafts.map((draft) =>
          draft.kind === 'local'
            ? {
                kind: 'local' as const,
                rootId: draft.preview.rootId,
                relativePath: draft.preview.relativePath,
                defaultBranch: draft.preview.defaultBranch,
                fingerprint: draft.preview.fingerprint,
              }
            : {
                kind: 'remote' as const,
                url: draft.url,
              },
        ),
      })
      .then((value) => {
        setSnapshot(value)
        setFactoryFilterId(projectFactoryId)
        setShowProjectSetup(false)
        setPreview(null)
        setRepositoryDrafts([])
      })
      .catch((caught: unknown) => {
        setProjectCreateError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setBusy(false))
  }

  const retryProjectSetup = () => {
    if (!activeProjectRef || activeLocatedProject?.factoryConnectionState !== 'connected') return
    void run(() => window.factoru.product.retry(activeProjectRef))
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProjectRef) return
    const form = event.currentTarget
    const data = new FormData(form)
    const text = String(data.get('message')).trim()
    if (!text) return
    void run(() => window.factoru.product.sendMessage(activeProjectRef, text)).then(
      (sent) => sent && form.reset(),
    )
  }

  const updateModel = (
    worker: WorkerType,
    slot: WorkerType['modelBindings'][number]['slot'],
    provider: string | null,
    model: string | null,
  ) => {
    if (!activeProjectRef) return
    void run(() =>
      window.factoru.product.updateModel({
        project: activeProjectRef,
        workerTypeKind: worker.kind,
        slot,
        provider,
        model,
      }),
    )
  }

  const updateWorkflowDefault = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProjectRef) return
    const data = new FormData(event.currentTarget)
    void run(() =>
      window.factoru.product.updateWorkflowDefault(
        activeProjectRef,
        String(data.get('workflowPresetId')) as 'standard-build' | 'fast-patch',
      ),
    )
  }

  const addMemory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProjectRef) return
    const form = event.currentTarget
    const data = new FormData(form)
    void run(() =>
      window.factoru.product.addMemory({
        project: activeProjectRef,
        scope: String(data.get('scope')) as 'project' | 'worker_type',
        workerTypeKind:
          data.get('scope') === 'worker_type'
            ? (String(data.get('workerTypeKind')) as WorkerType['kind'])
            : undefined,
        content: String(data.get('content')),
        provenanceRef: 'desktop:workers-memory-editor',
      }),
    ).then((value) => value && form.reset())
  }

  const createTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeProjectRef) return
    const form = event.currentTarget
    const data = new FormData(form)
    void run(() =>
      window.factoru.product.createTask({
        project: activeProjectRef,
        title: String(data.get('title')),
        description: String(data.get('description') || '') || undefined,
        status: String(data.get('status')) as 'backlog' | 'queue',
      }),
    ).then((value) => value && form.reset())
  }

  const updateTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const workflowPreset = data.get('workflowPresetId')
    const selectedWorkflowPreset = workflowPreset === null ? null : String(workflowPreset)
    const currentWorkflowPreset =
      task.workflowSelectionSource === 'pm' || task.workflowSelectionSource === 'user'
        ? (task.workflowPresetId ?? '')
        : ''
    void run(() =>
      window.factoru.product.updateTask({
        project: activeProjectRef!,
        taskId: task.id,
        title: String(data.get('title')),
        description: String(data.get('description')),
        priority: Number(data.get('priority')),
        workflowPresetId:
          selectedWorkflowPreset === null || selectedWorkflowPreset === currentWorkflowPreset
            ? undefined
            : selectedWorkflowPreset === ''
              ? null
              : (selectedWorkflowPreset as 'standard-build' | 'fast-patch'),
      }),
    )
  }

  const moveTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const status = String(data.get('status')) as Task['status']
    void run(() =>
      window.factoru.product.moveTask({
        project: activeProjectRef!,
        taskId: task.id,
        status,
        needsYouAction:
          status === 'needs_you'
            ? (String(data.get('needsYouAction')) as NonNullable<Task['needsYouAction']>)
            : undefined,
        needsYouMessage: status === 'needs_you' ? String(data.get('needsYouMessage')) : undefined,
      }),
    )
  }

  const queueTask = (task: Task) =>
    run(() =>
      window.factoru.product.moveTask({
        project: activeProjectRef!,
        taskId: task.id,
        status: 'queue',
      }),
    )

  const resolveTask = (event: FormEvent<HTMLFormElement>, task: Task) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const resolution = String(data.get('resolution')) as 'accepted' | 'rejected' | 'cancelled'
    const summary = String(data.get('summary')).trim()
    if (
      !window.confirm(`${statusLabel(resolution)} “${task.title}” and remove it from the board?`)
    ) {
      return
    }
    void run(() =>
      window.factoru.product.resolveTask({
        project: activeProjectRef!,
        taskId: task.id,
        resolution,
        summary,
      }),
    )
  }

  if (!snapshot?.initialized)
    return <main className="startup muted">Starting Factoru Desktop…</main>

  if (showPairing) {
    return (
      <main className="onboarding">
        <section className="onboarding-card" aria-labelledby="connect-heading">
          <div className="brand-mark" aria-hidden="true">
            F
          </div>
          <p className="eyebrow">Factoru Desktop</p>
          <h1 id="connect-heading">
            {connectionType === 'local' ? 'Connect Local Factory' : 'Connect another factory'}
          </h1>
          <p className="muted">
            {connectionType === 'local'
              ? 'Connect the built-in factory on this device. It stays available in the factory list.'
              : 'Add a remote Factoru Server. Local Factory stays available separately.'}
          </p>
          {connectionType === 'local' ? (
            <>
              <div className="local-intro">
                <strong>Connect to Factoru Server on this computer</strong>
                <p className="muted">
                  No address or pairing code needed. Start the server and Factoru will discover it
                  securely.
                </p>
              </div>
              <form className="form-stack" onSubmit={pairLocal}>
                <label>
                  Device name
                  <input name="deviceName" required defaultValue="My Mac" />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? 'Connecting…' : 'Connect on this device'}
                </button>
              </form>
            </>
          ) : (
            <>
              <form className="form-stack" onSubmit={pair}>
                <label>
                  Factory name
                  <input
                    name="factoryName"
                    required
                    maxLength={FACTORY_NAME_MAX_LENGTH}
                    defaultValue="Remote Factory"
                    placeholder="Raspberry Pi"
                  />
                </label>
                <label>
                  Server address
                  <input
                    name="url"
                    type="url"
                    required
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                  />
                </label>
                <label>
                  One-time pairing code
                  <input
                    name="code"
                    required
                    pattern="[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}"
                    placeholder="ABCD-EFGH-JKMN"
                  />
                </label>
                <label>
                  Device name
                  <input name="deviceName" required defaultValue="My Mac" />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? 'Connecting…' : 'Pair and connect'}
                </button>
              </form>
              <details className="server-install" open>
                <summary>Install Factoru Server on the remote machine</summary>
                <p className="muted">
                  Experimental source preview for 64-bit Linux. After cloning dev and logging into
                  Codex, install and validate the pinned host runtime in one command:
                </p>
                <pre aria-label="Remote server setup commands">
                  <code>{`./scripts/remote-bootstrap.sh --provider codex
factoru-server providers configure --provider codex`}</code>
                </pre>
                <p className="install-note">
                  Then run factoru-server start in tmux and use factoru-server pair --ssh-host
                  user@server. Keep Server on loopback. The complete source runbook is
                  docs/remote-connection.md; packaged installation remains Milestone 7 work.
                </p>
              </details>
            </>
          )}
          <button type="button" onClick={() => setShowPairing(false)}>
            Cancel
          </button>
          {(error || snapshot.error) && <p className="error">{error ?? snapshot.error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className={`workspace-shell ${showProjectSetup ? 'project-setup-open' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar-brand">
          <span className="brand-mark small" aria-hidden="true">
            F
          </span>
          <div>
            <strong>Factoru</strong>
            <span className="muted">Personal factory</span>
          </div>
        </header>

        <div className={`factory-switcher ${factorySwitcherOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="factory-switcher-trigger"
            aria-expanded={factorySwitcherOpen}
            aria-controls="factory-switcher-panel"
            aria-label={`Factories, ${factorySummary.label}`}
            onClick={() => {
              setFactorySwitcherOpen((open) => !open)
              setRenamingFactoryId(null)
            }}
          >
            <span className={`status-dot ${factorySummary.state}`} aria-hidden="true" />
            <span className="factory-switcher-title">
              <strong>{factorySummary.label}</strong>
            </span>
            <span className="factory-switcher-chevron" aria-hidden="true">
              ▾
            </span>
          </button>

          {factorySwitcherOpen && (
            <section
              id="factory-switcher-panel"
              className="factory-switcher-panel"
              aria-label="Factories"
            >
              <p className="factory-switcher-heading">Factories</p>
              <div className="factory-list">
                <button
                  type="button"
                  className={factoryFilterId === null ? 'active' : ''}
                  aria-current={factoryFilterId === null ? 'true' : undefined}
                  onClick={() => selectFactory(null)}
                >
                  <span className={`status-dot ${factorySummary.state}`} aria-hidden="true" />
                  <span>
                    <strong>All factories</strong>
                    <small>{factorySummary.label}</small>
                  </span>
                  <small>All projects</small>
                </button>
                {!hasLocalFactory && (
                  <button
                    type="button"
                    title="Connect Factoru Server on this device"
                    onClick={() => {
                      setFactorySwitcherOpen(false)
                      setConnectionType('local')
                      setError(null)
                      setShowPairing(true)
                    }}
                  >
                    <span className="status-dot pairing_required" aria-hidden="true" />
                    <span>
                      <strong>Local Factory</strong>
                      <small>This device</small>
                    </span>
                    <small>Not connected</small>
                  </button>
                )}
                {snapshot.profiles.map((profile) => (
                  <div className="factory-list-item" key={profile.serverId}>
                    <button
                      type="button"
                      className={profile.serverId === factoryFilterId ? 'active' : ''}
                      aria-current={profile.serverId === factoryFilterId ? 'true' : undefined}
                      title={profile.error ?? profile.url}
                      onClick={() => selectFactory(profile.serverId)}
                    >
                      <span
                        className={`status-dot ${profile.connectionState}`}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.kind === 'local' ? 'This device' : profile.url}</small>
                      </span>
                      <small>{factoryStatusLabel(profile.connectionState)}</small>
                    </button>
                    <button
                      type="button"
                      className="factory-manage-button"
                      aria-label={`Manage ${profile.name}`}
                      aria-expanded={managedFactoryId === profile.serverId}
                      onClick={() =>
                        setManagedFactoryId((current) =>
                          current === profile.serverId ? null : profile.serverId,
                        )
                      }
                    >
                      •••
                    </button>
                  </div>
                ))}
              </div>

              {managedFactory && renamingFactoryId === managedFactory.serverId ? (
                <form className="factory-rename" onSubmit={renameFactory}>
                  <label htmlFor="factory-name">Factory name</label>
                  <input
                    id="factory-name"
                    autoFocus
                    required
                    maxLength={FACTORY_NAME_MAX_LENGTH}
                    value={factoryName}
                    onChange={(event) => setFactoryName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      event.stopPropagation()
                      setRenamingFactoryId(null)
                      setFactoryName('')
                    }}
                  />
                  <div>
                    <button disabled={busy}>Save</button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFactoryId(null)
                        setFactoryName('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : managedFactory ? (
                <div className="factory-actions" aria-label={`${managedFactory.name} actions`}>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingFactoryId(managedFactory.serverId)
                      setFactoryName(managedFactory.name)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => reconnectFactory(managedFactory.serverId)}
                    disabled={busy}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => openTrustedDevices(managedFactory.serverId)}
                    disabled={managedFactory.connectionState !== 'connected' || busy}
                  >
                    Trusted devices
                  </button>
                  {managedFactory.kind === 'local' ? (
                    <span className="factory-built-in-note">Built in on this device</span>
                  ) : (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => forgetFactory(managedFactory)}
                    >
                      Forget factory
                    </button>
                  )}
                </div>
              ) : null}

              <button
                type="button"
                className="add-factory"
                onClick={() => {
                  setFactorySwitcherOpen(false)
                  setConnectionType('remote')
                  setShowPairing(true)
                }}
              >
                + Connect another factory
              </button>
            </section>
          )}
        </div>

        <div className="sidebar-section-head">
          <span>
            Projects ·{' '}
            {factoryFilterId
              ? (snapshot.profiles.find((profile) => profile.serverId === factoryFilterId)?.name ??
                'Factory')
              : 'All factories'}
          </span>
          <button
            className="icon-button"
            aria-label="Add project"
            title="Add project"
            onClick={() => void loadRoots()}
            disabled={onlineFactoryCount === 0 || busy}
          >
            +
          </button>
        </div>
        <nav className="project-nav" aria-label="Projects">
          {filteredProjects.length === 0 ? (
            <p className="empty-sidebar">
              {snapshot.projects.length === 0
                ? 'Create a project and add its repositories to begin.'
                : 'No projects match this factory filter.'}
            </p>
          ) : (
            filteredProjects.map((located) => (
              <button
                key={`${located.ref.factoryId}:${located.ref.projectId}`}
                className={
                  located.ref.factoryId === snapshot.activeProjectRef?.factoryId &&
                  located.ref.projectId === snapshot.activeProjectRef?.projectId
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  void run(() => window.factoru.product.selectProject(located.ref)).then(
                    (value) => value && setSnapshot(value),
                  )
                }
              >
                <span className="project-glyph">
                  {located.project.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{located.project.name}</strong>
                  <small>
                    {located.factoryName} · {statusLabel(located.project.setupState)} ·{' '}
                    {located.project.repositories.length}{' '}
                    {located.project.repositories.length === 1 ? 'rig' : 'rigs'}
                  </small>
                </span>
              </button>
            ))
          )}
        </nav>
      </aside>

      <section className="conversation-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">
              Project Manager
              {activeLocatedProject ? ` · ${activeLocatedProject.factoryName}` : ''}
              {activeProject?.projectDirectory ? ` · ${activeProject.projectDirectory.name}` : ''}
            </p>
            <h1>{activeProject?.name ?? 'Choose a project'}</h1>
          </div>
          {snapshot.workspace && (
            <span className={`health-pill ${snapshot.workspace.conversation.status}`}>
              {statusLabel(snapshot.workspace.conversation.status)}
            </span>
          )}
        </header>

        {snapshot.cached && (
          <p className="offline-banner">Showing cached history. Sending and editing are paused.</p>
        )}

        {!showProjectSetup && activeProject?.setupState !== 'ready' && activeProject && (
          <section
            className={`project-provisioning ${activeProject.setupState}`}
            aria-live="polite"
          >
            <div>
              <p className="eyebrow">Repository setup</p>
              <h2>{provisioningHeading(activeProject)}</h2>
              <p>
                {provisioningMessage(
                  activeProject,
                  activeLocatedProject?.factoryName ?? 'The home factory',
                )}
              </p>
              {activeProject.setupState === 'needs_attention' &&
                activeProject.repositories.some((repository) =>
                  repository.rig.error
                    ? repository.rig.error.code.startsWith('repository_') ||
                      repository.rig.error.code === 'git_unavailable'
                    : false,
                ) && (
                  <p className="provisioning-remedy">
                    Configure Git authentication for the operating-system user running{' '}
                    {activeLocatedProject?.factoryName ?? 'Factoru Server'}. Credentials and SSH
                    keys stay on that factory.
                  </p>
                )}
            </div>
            <ul>
              {activeProject.repositories.map((repository) => (
                <li key={repository.id}>
                  <span className={`status-dot ${repository.rig.registrationState}`} />
                  <span>
                    <strong>
                      {(repository.sourceUrl ?? repository.repository.relativePath) || 'Repository'}
                    </strong>
                    <small>
                      {repository.rig.retry
                        ? `Attempt ${repository.rig.retry.attemptCount} failed · retrying at ${new Date(
                            repository.rig.retry.nextAttemptAt,
                          ).toLocaleTimeString()}`
                        : statusLabel(repository.rig.registrationState)}
                    </small>
                    {repository.rig.error && (
                      <small className="provisioning-retry-error">
                        {repository.rig.error.message}
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {activeProject.setupState === 'needs_attention' && (
              <button
                className="primary"
                onClick={retryProjectSetup}
                disabled={
                  busy ||
                  activeLocatedProject?.factoryConnectionState !== 'connected' ||
                  snapshot.cached
                }
              >
                {busy ? 'Retrying…' : 'Retry repository setup'}
              </button>
            )}
          </section>
        )}

        {showProjectSetup ? (
          <section className="setup-panel">
            <header>
              <div>
                <p className="eyebrow">New project</p>
                <h2>Create a project</h2>
                <p className="setup-intro">
                  Choose the home factory, name the work, then add one or more Git repositories. The
                  first repository is the primary execution rig.
                </p>
              </div>
              <button onClick={() => setShowProjectSetup(false)}>Close</button>
            </header>
            <form className="project-create-form" onSubmit={createProject}>
              <fieldset className="factory-choice">
                <legend>Factories</legend>
                <p>
                  Choose one authoritative home factory for now. Additional execution factories are
                  planned for later.
                </p>
                {!hasLocalFactory && (
                  <label>
                    <input type="radio" name="projectFactory" disabled />
                    <span className="status-dot offline" aria-hidden="true" />
                    <span>
                      <strong>Local Factory</strong>
                      <small>Not available on this device</small>
                    </span>
                  </label>
                )}
                {snapshot.profiles.map((profile) => (
                  <label key={profile.serverId}>
                    <input
                      type="radio"
                      name="projectFactory"
                      value={profile.serverId}
                      checked={projectFactoryId === profile.serverId}
                      disabled={
                        profile.connectionState !== 'connected' || busy || checkingRepositoryAccess
                      }
                      onChange={() => void changeProjectFactory(profile.serverId)}
                    />
                    <span className={`status-dot ${profile.connectionState}`} aria-hidden="true" />
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{factoryStatusLabel(profile.connectionState)}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="project-basics">
                <label>
                  Project name
                  <input
                    autoFocus
                    required
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="My product"
                  />
                </label>
                <label>
                  Description <span className="optional">Optional</span>
                  <input
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                    placeholder="What are these repositories building together?"
                  />
                </label>
              </div>

              <fieldset className="factory-choice">
                <legend>Project Blueprint</legend>
                <p>Choose a ready starting structure. You can change the project workflow later.</p>
                <label>
                  <input
                    type="radio"
                    name="projectBlueprint"
                    value="standard-software-project"
                    checked={projectBlueprintId === 'standard-software-project'}
                    onChange={() => setProjectBlueprintId('standard-software-project')}
                  />
                  <span>
                    <strong>Standard Software Project · Recommended</strong>
                    <small>Full requirements-to-review lifecycle, with Fast Patch available.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="projectBlueprint"
                    value="fast-patch"
                    checked={projectBlueprintId === 'fast-patch'}
                    onChange={() => setProjectBlueprintId('fast-patch')}
                  />
                  <span>
                    <strong>Fast Patch</strong>
                    <small>Bounded implement, verify, review, and finalize by default.</small>
                  </span>
                </label>
              </fieldset>

              <div className="repository-picker-card">
                <div className="repository-picker-heading">
                  <div>
                    <strong>Repositories</strong>
                    <p>
                      Add a Git URL or import a clean repository available to {projectFactory?.name}
                      . Factoru keeps every repository in the project’s managed folder.
                    </p>
                  </div>
                  <span className="repository-count">{repositoryDrafts.length}</span>
                </div>

                <div className="url-add-row">
                  <input
                    type="text"
                    inputMode="url"
                    value={repositoryUrl}
                    onChange={(event) => {
                      setRepositoryUrl(event.target.value)
                      setRepositoryAccessError(null)
                      setProjectCreateError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && repositoryUrl.trim()) {
                        event.preventDefault()
                        void addRepositoryUrl()
                      }
                    }}
                    placeholder="https://github.com/organization/repository.git"
                    aria-label="Git repository URL"
                  />
                  <button
                    type="button"
                    onClick={() => void addRepositoryUrl()}
                    disabled={
                      !repositoryUrl.trim() ||
                      checkingRepositoryAccess ||
                      projectFactory?.connectionState !== 'connected'
                    }
                  >
                    {checkingRepositoryAccess ? 'Checking…' : 'Add URL'}
                  </button>
                </div>

                {repositoryAccessError && (
                  <div className="repository-access-error" role="alert">
                    <strong>Repository access must be fixed before continuing.</strong>
                    <p>{repositoryAccessError}</p>
                    <small>
                      On {projectFactory?.name ?? 'the factory'}, run{' '}
                      <code>factoru-server repositories check --url &lt;repository-url&gt;</code>{' '}
                      after configuring Git or SSH access.
                    </small>
                  </div>
                )}

                {projectFactory?.kind === 'local' && (
                  <>
                    <div className="picker-divider">
                      <span>or</span>
                    </div>

                    <button
                      className="native-picker-button"
                      type="button"
                      onClick={chooseRepositoryFolder}
                      disabled={busy}
                    >
                      <span className="folder-icon" aria-hidden="true">
                        ⌘
                      </span>
                      <span>
                        <strong>Import repository folder…</strong>
                        <small>Factoru clones its committed state into the project folder</small>
                      </span>
                    </button>
                  </>
                )}

                {roots.length > 0 && (
                  <button
                    className="server-browser-toggle"
                    type="button"
                    onClick={() => setShowServerBrowser((current) => !current)}
                  >
                    {showServerBrowser
                      ? 'Hide server browser'
                      : 'Import from approved server folders'}
                  </button>
                )}

                {showServerBrowser && (
                  <div className="server-browser">
                    <div className="browser-toolbar">
                      <select
                        value={rootId}
                        onChange={(event) => void browse(event.target.value, '')}
                      >
                        {roots.map((root) => (
                          <option key={root.id} value={root.id}>
                            {root.label}
                          </option>
                        ))}
                      </select>
                      {directory && (
                        <button
                          type="button"
                          onClick={() =>
                            void browse(rootId, directory.split('/').slice(0, -1).join('/'))
                          }
                        >
                          Up
                        </button>
                      )}
                      <code>/{directory}</code>
                    </div>
                    <ul className="repository-list">
                      {entries.map((entry) => (
                        <li key={`${entry.kind}:${entry.relativePath}`}>
                          <button
                            type="button"
                            onClick={() =>
                              entry.kind === 'directory'
                                ? void browse(rootId, entry.relativePath)
                                : void run(() =>
                                    window.factoru.product.preview(
                                      projectFactoryId,
                                      rootId,
                                      entry.relativePath,
                                    ),
                                  ).then((value) => value && addPreview(value))
                            }
                          >
                            <span>{entry.kind === 'directory' ? 'Folder' : 'Git'}</span>
                            {entry.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview && !preview.safe && (
                  <p className="error repository-error">{preview.blockedReason}</p>
                )}
              </div>

              {repositoryDrafts.length > 0 && (
                <ol className="selected-repositories">
                  {repositoryDrafts.map((draft, index) => (
                    <li key={draft.id}>
                      <span className="repository-order">{index + 1}</span>
                      <span className="repository-source-icon" aria-hidden="true">
                        {draft.kind === 'local' ? '⌘' : '↗'}
                      </span>
                      <span className="repository-summary">
                        <strong>
                          {draft.kind === 'local'
                            ? draft.preview.suggestedName
                            : draft.url
                                .split('/')
                                .at(-1)
                                ?.replace(/\.git$/, '') || draft.url}
                        </strong>
                        <small>
                          {draft.kind === 'local'
                            ? `${draft.preview.relativePath || '/'} · ${draft.preview.defaultBranch} · Will be imported`
                            : `${draft.url} · Access verified via ${draft.access.transport.toUpperCase()} (${draft.access.host})`}
                        </small>
                      </span>
                      {index === 0 && <span className="primary-rig-badge">Primary rig</span>}
                      <button
                        type="button"
                        className="remove-repository"
                        aria-label="Remove repository"
                        onClick={() =>
                          setRepositoryDrafts((current) =>
                            current.filter((candidate) => candidate.id !== draft.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              <footer className="project-create-actions">
                <div>
                  <p>
                    {repositoryDrafts.length === 0
                      ? 'Add at least one repository to continue.'
                      : `${repositoryDrafts.length} ${repositoryDrafts.length === 1 ? 'repository' : 'repositories'} will be placed in one managed project folder.`}
                  </p>
                  {projectCreateError && (
                    <p className="error" role="alert">
                      {projectCreateError} The project was not created; your repository selections
                      are still here.
                    </p>
                  )}
                </div>
                <button
                  className="primary"
                  disabled={
                    !projectName.trim() ||
                    repositoryDrafts.length === 0 ||
                    projectFactory?.connectionState !== 'connected' ||
                    checkingRepositoryAccess ||
                    busy
                  }
                >
                  {busy ? 'Creating…' : 'Create project'}
                </button>
              </footer>
            </form>
          </section>
        ) : !snapshot.workspace ? (
          <section className="empty-state">
            <h2>No project selected</h2>
            <p>Create a project with one or more repositories, or choose one from the sidebar.</p>
          </section>
        ) : (
          <>
            <div className="message-list" aria-live="polite">
              {snapshot.workspace.conversation.messages.length === 0 ? (
                <section className="conversation-empty">
                  <span className="avatar">PM</span>
                  <h2>What should we work on?</h2>
                  <p>
                    Discuss the repository, clarify a direction, or ask the Project Manager to help
                    shape the next task.
                  </p>
                </section>
              ) : (
                snapshot.workspace.conversation.messages.map((message) => (
                  <article key={message.id} className={`message ${message.role}`}>
                    <header>
                      <strong>{message.role === 'assistant' ? 'Project Manager' : 'You'}</strong>
                      <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
                    </header>
                    <p>{message.text}</p>
                    <footer>
                      {statusLabel(message.deliveryState)}
                      {message.tokenUsage &&
                        ` · ${message.tokenUsage.input + message.tokenUsage.output} tokens`}
                      {message.toolActivity.length > 0 &&
                        ` · ${message.toolActivity.length} tool activities`}
                    </footer>
                  </article>
                ))
              )}
            </div>
            <form className="composer" onSubmit={sendMessage}>
              <textarea
                name="message"
                rows={3}
                maxLength={32_000}
                placeholder="Message your Project Manager…"
                disabled={!snapshot.connected || busy}
              />
              <button className="primary" disabled={!snapshot.connected || busy}>
                Send
              </button>
            </form>
          </>
        )}
      </section>

      <aside className="inspector-pane">
        <header className="inspector-tabs">
          <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
            Tasks
          </button>
          <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
            Team
          </button>
        </header>

        {tab === 'tasks' ? (
          <div className="task-board" aria-label="Tasks">
            {snapshot.workspace ? (
              <>
                <section className="board-toolbar">
                  <details>
                    <summary>Capture a task</summary>
                    <form className="task-create-form" onSubmit={createTask}>
                      <input name="title" required maxLength={200} placeholder="A rough thought…" />
                      <textarea
                        name="description"
                        rows={2}
                        maxLength={20_000}
                        placeholder="Optional context or acceptance criteria"
                      />
                      <select name="status" defaultValue="backlog">
                        <option value="backlog">Save to Backlog</option>
                        <option value="queue">Save and request planning</option>
                      </select>
                      <button className="primary" disabled={!snapshot.connected || busy}>
                        Add task
                      </button>
                    </form>
                  </details>
                  <div className="queue-summary" aria-live="polite">
                    <strong>Execution WIP {snapshot.workspace.factory.executionWipLimit}</strong>
                    {snapshot.workspace.queueReconciliation ? (
                      <span
                        className={`health-pill ${snapshot.workspace.queueReconciliation.status}`}
                      >
                        Planning {statusLabel(snapshot.workspace.queueReconciliation.status)} · r
                        {snapshot.workspace.queueReconciliation.coalescedThroughRevision}
                      </span>
                    ) : (
                      <span className="muted">Queue is settled</span>
                    )}
                  </div>
                  {snapshot.workspace.taskMergeProposals.map((proposal) => {
                    const source = snapshot.workspace!.tasks.find(
                      (task) => task.id === proposal.sourceTaskId,
                    )
                    const target = snapshot.workspace!.tasks.find(
                      (task) => task.id === proposal.targetTaskId,
                    )
                    return (
                      <article className="merge-proposal" key={proposal.id}>
                        <strong>Merge confirmation</strong>
                        <p>
                          Merge “{source?.title ?? proposal.sourceTaskId}” into “
                          {target?.title ?? proposal.targetTaskId}”? {proposal.reason}
                        </p>
                        <div>
                          <button
                            className="primary"
                            disabled={!snapshot.connected || busy}
                            onClick={() =>
                              void run(() =>
                                window.factoru.product.decideTaskMerge({
                                  project: activeProjectRef!,
                                  proposalId: proposal.id,
                                  decision: 'accept',
                                }),
                              )
                            }
                          >
                            Confirm merge
                          </button>
                          <button
                            disabled={!snapshot.connected || busy}
                            onClick={() =>
                              void run(() =>
                                window.factoru.product.decideTaskMerge({
                                  project: activeProjectRef!,
                                  proposalId: proposal.id,
                                  decision: 'reject',
                                }),
                              )
                            }
                          >
                            Keep separate
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </section>
                <div className="task-grid">
                  {taskColumns.map(([id, label]) => {
                    const tasks = snapshot.workspace!.tasks.filter((task) => task.status === id)
                    return (
                      <section key={id} className="task-column">
                        <header>
                          <span className={`column-dot ${id}`} />
                          <h2>{label}</h2>
                          <span>{tasks.length}</span>
                        </header>
                        <div className="task-list">
                          {tasks.length === 0 ? (
                            <p>No tasks</p>
                          ) : (
                            tasks.map((task) => {
                              const taskRun = snapshot.workspace!.taskRuns.find(
                                (candidate) => candidate.taskId === task.id,
                              )
                              return (
                                <article className="task-card" key={`${task.id}:${task.version}`}>
                                  <header>
                                    <strong>{task.title}</strong>
                                    {task.queuePhase && (
                                      <span className="phase-badge">
                                        {statusLabel(task.queuePhase)}
                                      </span>
                                    )}
                                  </header>
                                  {task.description && <p>{task.description}</p>}
                                  {task.status === 'needs_you' && (
                                    <div className="needs-action">
                                      <strong>{statusLabel(task.needsYouAction!)}</strong>
                                      <span>{task.needsYouMessage}</span>
                                    </div>
                                  )}
                                  {taskRun && (
                                    <section
                                      className="run-summary"
                                      aria-label="Software delivery run"
                                    >
                                      <header>
                                        <strong>{statusLabel(taskRun.stage)}</strong>
                                        <span className={`health-pill ${taskRun.status}`}>
                                          {statusLabel(taskRun.status)}
                                        </span>
                                      </header>
                                      <div className="run-meter">
                                        {taskRun.steps.map((step) => (
                                          <span
                                            className={step.status}
                                            key={step.id}
                                            title={step.title}
                                          >
                                            {statusLabel(step.title)}
                                          </span>
                                        ))}
                                      </div>
                                      <p>
                                        {taskRun.usage.inputTokens + taskRun.usage.outputTokens}{' '}
                                        tokens ·{' '}
                                        {taskRun.usage.pricing === 'priced'
                                          ? `$${taskRun.usage.estimatedCostUsd.toFixed(4)} estimated`
                                          : taskRun.usage.pricing === 'unpriced'
                                            ? 'cost unpriced by the configured provider'
                                            : 'cost pending'}
                                      </p>
                                      {taskRun.error && (
                                        <p className="run-error">
                                          {taskRun.error.code}: {taskRun.error.message}
                                        </p>
                                      )}
                                      {(taskRun.logs.length > 0 || taskRun.reviewPackage) && (
                                        <details className="run-evidence">
                                          <summary>Logs and evidence</summary>
                                          {taskRun.logs.map((entry, index) => (
                                            <pre key={index}>{entry}</pre>
                                          ))}
                                          {taskRun.reviewPackage && (
                                            <>
                                              <strong>Commits</strong>
                                              <pre>{taskRun.reviewPackage.commits.join('\n')}</pre>
                                              <strong>Checks</strong>
                                              <pre>{taskRun.reviewPackage.checks.output}</pre>
                                              <strong>Independent review</strong>
                                              <pre>{taskRun.reviewPackage.internalReview}</pre>
                                              <strong>Diff</strong>
                                              <pre>{taskRun.reviewPackage.diff}</pre>
                                              {taskRun.reviewPackage.unresolvedRisks.length > 0 && (
                                                <p className="run-error">
                                                  Risks:{' '}
                                                  {taskRun.reviewPackage.unresolvedRisks.join('; ')}
                                                </p>
                                              )}
                                            </>
                                          )}
                                        </details>
                                      )}
                                      <div className="run-actions">
                                        {['pending', 'running', 'cancelling'].includes(
                                          taskRun.status,
                                        ) && (
                                          <button
                                            disabled={
                                              !snapshot.connected ||
                                              busy ||
                                              taskRun.status === 'cancelling'
                                            }
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.cancelRun(
                                                  activeProjectRef!,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Cancel run
                                          </button>
                                        )}
                                        {taskRun.status === 'completed' && (
                                          <>
                                            <button
                                              className="primary"
                                              disabled={!snapshot.connected || busy}
                                              onClick={() =>
                                                window.confirm('Approve this implementation?') &&
                                                void run(() =>
                                                  window.factoru.product.approveRun(
                                                    activeProjectRef!,
                                                    taskRun.id,
                                                    'Accepted after reviewing the delivery evidence.',
                                                  ),
                                                )
                                              }
                                            >
                                              Approve
                                            </button>
                                            <button
                                              disabled={!snapshot.connected || busy}
                                              onClick={() => {
                                                const feedback = window
                                                  .prompt('What should the implementation change?')
                                                  ?.trim()
                                                if (feedback)
                                                  void run(() =>
                                                    window.factoru.product.requestRunChanges(
                                                      activeProjectRef!,
                                                      taskRun.id,
                                                      feedback,
                                                    ),
                                                  )
                                              }}
                                            >
                                              Request changes
                                            </button>
                                          </>
                                        )}
                                        {taskRun.status === 'failed' && (
                                          <button
                                            disabled={!snapshot.connected || busy}
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.retryRun(
                                                  activeProjectRef!,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Retry
                                          </button>
                                        )}
                                        {['completed', 'failed', 'cancelled'].includes(
                                          taskRun.status,
                                        ) && (
                                          <button
                                            disabled={!snapshot.connected || busy}
                                            onClick={() =>
                                              void run(() =>
                                                window.factoru.product.archiveRun(
                                                  activeProjectRef!,
                                                  taskRun.id,
                                                ),
                                              )
                                            }
                                          >
                                            Archive run
                                          </button>
                                        )}
                                      </div>
                                    </section>
                                  )}
                                  <footer>
                                    <span>Priority {task.priority}</span>
                                    <span>
                                      {task.workerTypeKind
                                        ? statusLabel(task.workerTypeKind)
                                        : 'Unassigned'}
                                    </span>
                                    <span>
                                      {task.workflowPresetId
                                        ? (snapshot.workspace!.workflowPresets.find(
                                            (preset) => preset.id === task.workflowPresetId,
                                          )?.name ?? statusLabel(task.workflowPresetId))
                                        : 'Project workflow'}
                                      {task.workflowLockedByUser ? ' · locked' : ''}
                                    </span>
                                  </footer>
                                  {task.status === 'backlog' && (
                                    <button
                                      className="queue-button"
                                      disabled={!snapshot.connected || busy}
                                      onClick={() => void queueTask(task)}
                                    >
                                      Move to Queue
                                    </button>
                                  )}
                                  <details className="task-details">
                                    <summary>Edit and move</summary>
                                    <form onSubmit={(event) => updateTask(event, task)}>
                                      <input
                                        name="title"
                                        required
                                        defaultValue={task.title}
                                        maxLength={200}
                                      />
                                      <textarea
                                        name="description"
                                        rows={3}
                                        defaultValue={task.description}
                                        maxLength={20_000}
                                      />
                                      <label>
                                        Priority
                                        <input
                                          name="priority"
                                          type="number"
                                          min={0}
                                          max={100}
                                          defaultValue={task.priority}
                                        />
                                      </label>
                                      {snapshot.workspace!.workflowPresets.length > 0 && (
                                        <label>
                                          Workflow preset
                                          <select
                                            name="workflowPresetId"
                                            defaultValue={
                                              task.workflowSelectionSource === 'pm' ||
                                              task.workflowSelectionSource === 'user'
                                                ? (task.workflowPresetId ?? '')
                                                : ''
                                            }
                                            disabled={task.status === 'in_progress'}
                                          >
                                            <option value="">
                                              Project default (
                                              {snapshot.workspace!.workflowPresets.find(
                                                (preset) =>
                                                  preset.id ===
                                                  snapshot.workspace!.factory
                                                    .defaultWorkflowPresetId,
                                              )?.name ??
                                                statusLabel(
                                                  snapshot.workspace!.factory
                                                    .defaultWorkflowPresetId,
                                                )}
                                              )
                                            </option>
                                            {snapshot
                                              .workspace!.workflowPresets.filter((preset) =>
                                                snapshot.workspace!.blueprint.allowedWorkflowPresetIds.includes(
                                                  preset.id,
                                                ),
                                              )
                                              .map((preset) => (
                                                <option value={preset.id} key={preset.id}>
                                                  {preset.name}
                                                </option>
                                              ))}
                                          </select>
                                        </label>
                                      )}
                                      <button disabled={!snapshot.connected || busy}>
                                        Save edits
                                      </button>
                                    </form>
                                    <form onSubmit={(event) => moveTask(event, task)}>
                                      <select name="status" defaultValue={task.status}>
                                        {taskColumns.map(([value, text]) => (
                                          <option value={value} key={value}>
                                            {text}
                                          </option>
                                        ))}
                                      </select>
                                      <select name="needsYouAction" defaultValue="clarify">
                                        <option value="clarify">Clarify</option>
                                        <option value="approve">Approve</option>
                                        <option value="review">Review</option>
                                        <option value="resolve_conflict">Resolve conflict</option>
                                        <option value="recover_failure">Recover failure</option>
                                      </select>
                                      <input
                                        name="needsYouMessage"
                                        placeholder="Required when moving to Needs you"
                                      />
                                      <button disabled={!snapshot.connected || busy}>Move</button>
                                    </form>
                                    <form onSubmit={(event) => resolveTask(event, task)}>
                                      <select name="resolution" defaultValue="cancelled">
                                        <option value="accepted">Accepted</option>
                                        <option value="rejected">Rejected</option>
                                        <option value="cancelled">Cancelled</option>
                                      </select>
                                      <input
                                        name="summary"
                                        required
                                        placeholder="Why is this terminal?"
                                      />
                                      <button
                                        className="danger"
                                        disabled={!snapshot.connected || busy}
                                      >
                                        Resolve task
                                      </button>
                                    </form>
                                  </details>
                                </article>
                              )
                            })
                          )}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="board-note">Choose a project to see its task board.</p>
            )}
          </div>
        ) : snapshot.workspace ? (
          <div className="workers-panel" aria-label="Team">
            <section className="factory-card">
              <div>
                <p className="eyebrow">{snapshot.workspace.blueprint.name}</p>
                <strong>1 implementation at a time</strong>
              </div>
              <span className="health-pill ready">Serial MVP</span>
            </section>

            {snapshot.workspace.workflowPresets.length > 0 && (
              <section className="worker-card">
                <header>
                  <div>
                    <h2>Project workflow</h2>
                    <p>Tasks inherit this preset unless a user locks an override.</p>
                  </div>
                </header>
                <form className="model-row" onSubmit={updateWorkflowDefault}>
                  <label htmlFor="project-workflow-preset">Default preset</label>
                  <select
                    id="project-workflow-preset"
                    name="workflowPresetId"
                    defaultValue={snapshot.workspace.factory.defaultWorkflowPresetId}
                    disabled={!snapshot.connected}
                  >
                    {snapshot.workspace.workflowPresets
                      .filter((preset) =>
                        snapshot.workspace!.blueprint.allowedWorkflowPresetIds.includes(preset.id),
                      )
                      .map((preset) => (
                        <option value={preset.id} key={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                  </select>
                  <button disabled={!snapshot.connected || busy}>Save default</button>
                </form>
              </section>
            )}

            <section
              className={`model-catalog-card ${snapshot.workspace.modelCatalog.status}`}
              aria-live="polite"
            >
              <strong>
                {snapshot.workspace.modelCatalog.status === 'ready' &&
                snapshot.workspace.modelCatalog.providers.length > 0
                  ? `Models loaded from ${snapshot.workspace.modelCatalog.providers.length} configured ${
                      snapshot.workspace.modelCatalog.providers.length === 1
                        ? 'provider'
                        : 'providers'
                    }`
                  : 'Provider models unavailable'}
              </strong>
              <p>
                {snapshot.workspace.modelCatalog.message ??
                  'Choose a provider and Factoru will select its default model automatically.'}
              </p>
            </section>

            {snapshot.workspace.team.map((worker) => (
              <section className="worker-card" key={worker.kind}>
                <header>
                  <span className="avatar">{worker.kind === 'project_manager' ? 'PM' : 'SE'}</span>
                  <div>
                    <h2>{worker.displayName}</h2>
                    <p>{worker.defaultFormula}</p>
                  </div>
                  <span className="health-pill ready">capacity {worker.capacity}</span>
                </header>
                <details open>
                  <summary>Model slots</summary>
                  {worker.modelBindings.map((binding) => (
                    <ModelBindingEditor
                      key={`${binding.slot}:${binding.version}`}
                      binding={binding}
                      catalog={snapshot.workspace!.modelCatalog}
                      connected={snapshot.connected}
                      busy={busy}
                      onSave={(provider, model) =>
                        updateModel(worker, binding.slot, provider, model)
                      }
                    />
                  ))}
                </details>
                <details>
                  <summary>Policy & tools</summary>
                  <p>{worker.memoryPolicy.replaceAll('_', ' ')}</p>
                  <ul>
                    {worker.allowedTools.map((tool) => (
                      <li key={tool}>{tool}</li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}

            <section className="worker-card planner-card">
              <header>
                <div>
                  <h2>Planner isolation probe</h2>
                  <p>Runs separately while chat stays responsive.</p>
                </div>
                {snapshot.workspace.plannerProbe && (
                  <span className={`health-pill ${snapshot.workspace.plannerProbe.status}`}>
                    {statusLabel(snapshot.workspace.plannerProbe.status)}
                  </span>
                )}
              </header>
              {snapshot.workspace.plannerProbe &&
              ['pending', 'running', 'cancelling'].includes(
                snapshot.workspace.plannerProbe.status,
              ) ? (
                <button
                  disabled={!snapshot.connected || busy}
                  onClick={() =>
                    void run(() =>
                      window.factoru.product.cancelPlanner(
                        activeProjectRef!,
                        snapshot.workspace!.plannerProbe!.id,
                      ),
                    )
                  }
                >
                  Cancel planner probe
                </button>
              ) : (
                <button
                  disabled={!snapshot.connected || busy}
                  onClick={() =>
                    void run(() => window.factoru.product.startPlanner(activeProjectRef!))
                  }
                >
                  Run planner probe
                </button>
              )}
            </section>

            <section className="worker-card memory-card">
              <header>
                <div>
                  <h2>Durable memory</h2>
                  <p>Every entry keeps explicit provenance and version history.</p>
                </div>
              </header>
              <ul>
                {snapshot.workspace.memory.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.content}</span>
                    <small>
                      {entry.scope} · v{entry.version} · {entry.provenance.ref}
                    </small>
                  </li>
                ))}
              </ul>
              <form className="form-stack compact" onSubmit={addMemory}>
                <label>
                  Scope
                  <select name="scope" defaultValue="project">
                    <option value="project">Project</option>
                    <option value="worker_type">Team role</option>
                  </select>
                </label>
                <label>
                  Team role
                  <select name="workerTypeKind" defaultValue="project_manager">
                    <option value="project_manager">Project Manager</option>
                    <option value="software_engineer">Software Engineer</option>
                  </select>
                </label>
                <textarea name="content" required rows={3} placeholder="A durable project fact…" />
                <button disabled={!snapshot.connected || busy}>Add memory</button>
              </form>
            </section>
          </div>
        ) : (
          <div className="empty-state small">Choose a project to inspect its team.</div>
        )}
      </aside>

      {!snapshot.remoteFactoryIntroComplete && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="remote-factory-intro"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remote-factory-intro-heading"
            onKeyDown={(event) => {
              if (event.key === 'Escape') completeRemoteFactoryIntro(false)
            }}
          >
            <p className="eyebrow">Run work anywhere</p>
            <h2 id="remote-factory-intro-heading">Add a remote factory</h2>
            <p>
              Keep Factoru running on a Raspberry Pi, Mac, or Linux host while this Desktop stays
              connected to Local Factory too. Each project chooses one home factory.
            </p>
            <ol>
              <li>Install and start Factoru Server on the remote host.</li>
              <li>Keep it on loopback and create an SSH local-forward for this source preview.</li>
              <li>Generate a pairing code, then add the forwarded Desktop URL here.</li>
            </ol>
            <pre>
              <code>{`factoru-server status
factoru-server pair --ssh-host user@server`}</code>
            </pre>
            <p className="muted">
              The complete development instructions are in docs/remote-connection.md. Packaged setup
              remains Milestone 7 work.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => completeRemoteFactoryIntro(false)}>
                Not now
              </button>
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => completeRemoteFactoryIntro(true)}
              >
                Add remote factory
              </button>
            </div>
          </section>
        </div>
      )}

      {showDevices && deviceFactory && (
        <section className="device-drawer" aria-labelledby="trusted-devices-heading">
          <header>
            <div>
              <h2 id="trusted-devices-heading">Trusted devices</h2>
              <p className="muted">{deviceFactory.name}</p>
            </div>
            <button
              onClick={() => {
                setShowDevices(false)
                setDeviceFactoryId(null)
                setDevices([])
              }}
            >
              Close
            </button>
          </header>
          {devices.length === 0 ? (
            <p className="muted">No trusted devices found for this factory.</p>
          ) : (
            devices.map((device) => (
              <div key={device.id}>
                <span>{device.name}</span>
                {!device.revokedAt && (
                  <button
                    onClick={() =>
                      window.confirm(`Revoke ${device.name}?`) &&
                      void run(() =>
                        window.factoru.product.revoke(deviceFactory.serverId, device.id),
                      ).then(() =>
                        window.factoru.product.devices(deviceFactory.serverId).then(setDevices),
                      )
                    }
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {(error || snapshot.error) && (
        <div className="toast error" role="alert">
          <span>{error ?? snapshot.error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </main>
  )
}
