import fs from 'node:fs'
import path from 'node:path'
import { GasCityError } from './errors.js'
import type { CommandExecutor } from './registration.js'

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const SESSIONS_BEGIN = '# factoru-managed project sessions: begin'
const SESSIONS_END = '# factoru-managed project sessions: end'

export interface ProjectAgentBinding {
  provider: string | null
  model: string | null
}

export interface ProjectRuntimeConfiguration {
  projectId: string
  projectName: string
  rigName: string
  chatAgentName: string
  chat: ProjectAgentBinding
  planning: ProjectAgentBinding
  implementation: ProjectAgentBinding
  review: ProjectAgentBinding
}

export interface ProjectRuntimeConfigurator {
  reconcile(projects: readonly ProjectRuntimeConfiguration[]): Promise<boolean>
}

export interface GasCityProjectConfiguratorOptions {
  cityPath: string
  projectManagerPromptPath: string
  executor: CommandExecutor
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME.test(value)) {
    throw new GasCityError(`Invalid ${label}: ${value}`, { kind: 'invalid_request' })
  }
}

function assertBinding(binding: ProjectAgentBinding): void {
  if ((binding.provider === null) !== (binding.model === null)) {
    throw new GasCityError('Provider and model must be configured together', {
      kind: 'invalid_request',
    })
  }
  for (const value of [binding.provider, binding.model]) {
    if (value !== null && (value.length > 160 || /[\r\n\0]/.test(value))) {
      throw new GasCityError('Provider and model identifiers must be single-line values', {
        kind: 'invalid_request',
      })
    }
  }
}

function replaceManagedBlock(source: string, begin: string, end: string, body: string): string {
  const block = `${begin}\n${body}${body ? '\n' : ''}${end}`
  const start = source.indexOf(begin)
  const finish = source.indexOf(end)
  if (start >= 0 !== finish >= 0 || (start >= 0 && finish < start)) {
    throw new GasCityError(`Gas City config has a malformed ${begin} block`, {
      kind: 'invalid_request',
    })
  }
  if (start < 0) return `${source.trimEnd()}\n\n${block}\n`
  return `${source.slice(0, start)}${block}${source.slice(finish + end.length)}`
}

function atomicWriteIfChanged(file: string, content: string): boolean {
  const current = fs.readFileSync(file, 'utf8')
  if (current === content) return false
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new GasCityError(`Refusing to replace non-regular config file ${file}`, {
      kind: 'invalid_request',
    })
  }
  const temporary = `${file}.factoru-${process.pid}.tmp`
  fs.writeFileSync(temporary, content, { mode: stat.mode & 0o777 })
  fs.renameSync(temporary, file)
  return true
}

function bindingLines(binding: ProjectAgentBinding): string[] {
  return binding.provider && binding.model
    ? [
        `provider = ${tomlString(binding.provider)}`,
        `option_defaults = { model = ${tomlString(binding.model)} }`,
      ]
    : []
}

function agentFile(project: ProjectRuntimeConfiguration): string {
  const lines = [
    `description = ${tomlString(`Factoru Project Manager chat for ${project.projectName}`)}`,
    'max_active_sessions = 1',
    ...bindingLines(project.chat),
  ]
  return `${lines.join('\n')}\n`
}

function sessionBlocks(projects: readonly ProjectRuntimeConfiguration[]): string {
  return [...projects]
    .sort((left, right) => left.chatAgentName.localeCompare(right.chatAgentName))
    .map(
      (project) =>
        `[[named_session]]\ntemplate = ${tomlString(project.chatAgentName)}\nmode = "always"`,
    )
    .join('\n\n')
}

function patchBlock(project: ProjectRuntimeConfiguration): string {
  const bindings: Array<[string, ProjectAgentBinding]> = [
    ['project-manager-planner', project.planning],
    ['software-implementer', project.implementation],
    ['software-reviewer', project.review],
  ]
  return bindings
    .filter(([, binding]) => binding.provider !== null)
    .map(
      ([agent, binding]) =>
        `[[rigs.patches]]\nagent = ${tomlString(agent)}\n${bindingLines(binding).join('\n')}`,
    )
    .join('\n\n')
}

function updateRigBlock(source: string, project: ProjectRuntimeConfiguration): string {
  const begin = `# factoru-managed bindings ${project.projectId}: begin`
  const end = `# factoru-managed bindings ${project.projectId}: end`
  const headings = [...source.matchAll(/^\[\[rigs\]\]\s*$/gm)]
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index]!.index
    const finish = headings[index + 1]?.index ?? source.length
    const section = source.slice(start, finish)
    const name = /^name\s*=\s*"([a-zA-Z0-9_-]+)"\s*$/m.exec(section)?.[1]
    if (name !== project.rigName) continue
    const updated = replaceManagedBlock(section, begin, end, patchBlock(project))
    return `${source.slice(0, start)}${updated}${source.slice(finish)}`
  }
  throw new GasCityError(`Rig ${project.rigName} is missing from city.toml`, {
    kind: 'not_found',
  })
}

/**
 * Projects Factoru-owned Worker Type bindings into the dedicated city.
 *
 * Root-pack named sessions are city scoped in Gas City 1.4.0. Each project
 * therefore gets a distinct local chat agent/template and named session, while
 * planner/implementer/reviewer model choices are rig patches on the imported
 * Factoru pack agents. The two generated regions are bounded and idempotent;
 * unrelated city configuration is preserved byte-for-byte.
 */
export class GasCityProjectConfigurator implements ProjectRuntimeConfigurator {
  readonly #cityPath: string
  readonly #promptPath: string
  readonly #executor: CommandExecutor

  constructor(options: GasCityProjectConfiguratorOptions) {
    if (!path.isAbsolute(options.cityPath) || !path.isAbsolute(options.projectManagerPromptPath)) {
      throw new GasCityError('Gas City configuration paths must be absolute', {
        kind: 'invalid_request',
      })
    }
    this.#cityPath = options.cityPath
    this.#promptPath = options.projectManagerPromptPath
    this.#executor = options.executor
  }

  async reconcile(projects: readonly ProjectRuntimeConfiguration[]): Promise<boolean> {
    for (const project of projects) {
      assertSafeName(project.projectId, 'project ID')
      assertSafeName(project.rigName, 'rig name')
      assertSafeName(project.chatAgentName, 'chat agent name')
      for (const binding of [
        project.chat,
        project.planning,
        project.implementation,
        project.review,
      ]) {
        assertBinding(binding)
      }
    }
    const packFile = path.join(this.#cityPath, 'pack.toml')
    const cityFile = path.join(this.#cityPath, 'city.toml')
    const agentsDirectory = path.join(this.#cityPath, 'agents')
    const prompt = fs.readFileSync(this.#promptPath, 'utf8')
    let changed = false

    for (const project of projects) {
      const directory = path.join(agentsDirectory, project.chatAgentName)
      if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
        throw new GasCityError(`Refusing to traverse chat-agent symlink ${directory}`, {
          kind: 'invalid_request',
        })
      }
      fs.mkdirSync(directory, { recursive: true })
      const agentPath = path.join(directory, 'agent.toml')
      const promptPath = path.join(directory, 'prompt.template.md')
      for (const [file, content] of [
        [agentPath, agentFile(project)],
        [promptPath, prompt],
      ] as const) {
        if (fs.existsSync(file)) changed = atomicWriteIfChanged(file, content) || changed
        else {
          fs.writeFileSync(file, content, { mode: 0o600, flag: 'wx' })
          changed = true
        }
      }
    }

    const pack = fs.readFileSync(packFile, 'utf8')
    changed =
      atomicWriteIfChanged(
        packFile,
        replaceManagedBlock(pack, SESSIONS_BEGIN, SESSIONS_END, sessionBlocks(projects)),
      ) || changed

    let city = fs.readFileSync(cityFile, 'utf8')
    for (const project of projects) city = updateRigBlock(city, project)
    changed = atomicWriteIfChanged(cityFile, city) || changed

    if (changed) {
      try {
        await this.#executor.run('gc', ['reload', '--city', this.#cityPath])
      } catch (cause) {
        throw new GasCityError(
          `Gas City rejected Factoru's project runtime configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
          { kind: 'unavailable', cause },
        )
      }
    }
    return changed
  }
}
