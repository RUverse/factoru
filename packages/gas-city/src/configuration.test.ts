import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GasCityProjectConfigurator } from './configuration.js'
import type { CommandExecutor } from './registration.js'

const directories: string[] = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-gas-config-'))
  directories.push(root)
  fs.mkdirSync(path.join(root, 'agents'))
  fs.writeFileSync(path.join(root, 'pack.toml'), '[pack]\nname = "factoru-city"\nschema = 2\n')
  fs.writeFileSync(
    path.join(root, 'city.toml'),
    '[workspace]\nprovider = "claude"\n\n[[rigs]]\nname = "factoru-rig"\npath = "/repos/factoru"\n',
  )
  const prompt = path.join(root, 'source-prompt.md')
  fs.writeFileSync(prompt, '# Project Manager\n')
  const run = vi.fn(async () => ({ stdout: '', stderr: '' }))
  const executor: CommandExecutor = { run }
  return {
    root,
    prompt,
    run,
    executor,
    configurator: new GasCityProjectConfigurator({
      cityPath: root,
      factoruServerUrl: 'http://127.0.0.1:8787',
      projectManagerPromptPath: prompt,
      executor,
    }),
  }
}

const project = {
  projectId: 'prj_11111111111111111111111111111111',
  projectName: 'Factoru',
  rigName: 'factoru-rig',
  chatAgentName: 'project-manager-chat-111111111111',
  chat: { provider: 'anthropic', model: 'claude-sonnet' },
  planning: { provider: 'openai', model: 'codex' },
  implementation: { provider: 'anthropic', model: 'claude-sonnet' },
  review: { provider: 'openai', model: 'codex' },
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('GasCityProjectConfigurator', () => {
  it('creates a distinct named-session chat identity and rig-scoped model patches', async () => {
    const { root, run, configurator } = fixture()
    expect(await configurator.reconcile([project])).toBe(true)
    expect(fs.readFileSync(path.join(root, 'pack.toml'), 'utf8')).toContain(
      'template = "project-manager-chat-111111111111"',
    )
    expect(
      fs.readFileSync(
        path.join(root, 'agents/project-manager-chat-111111111111/agent.toml'),
        'utf8',
      ),
    ).toContain('option_defaults = { model = "claude-sonnet" }')
    const city = fs.readFileSync(path.join(root, 'city.toml'), 'utf8')
    expect(city).toContain('agent = "project-manager-planner"')
    expect(city).toContain('agent = "software-reviewer"')
    expect(run).toHaveBeenCalledWith('gc', ['reload', '--city', root])
    expect(fs.readFileSync(path.join(root, '.gc/factoru-server.json'), 'utf8')).toBe(
      '{\n  "version": 1,\n  "serverUrl": "http://127.0.0.1:8787"\n}\n',
    )
    expect(fs.statSync(path.join(root, '.gc/factoru-server.json')).mode & 0o777).toBe(0o600)
  })

  it('is byte-idempotent and does not reload unchanged configuration', async () => {
    const { root, run, configurator } = fixture()
    await configurator.reconcile([project])
    const firstPack = fs.readFileSync(path.join(root, 'pack.toml'), 'utf8')
    const firstCity = fs.readFileSync(path.join(root, 'city.toml'), 'utf8')
    expect(await configurator.reconcile([project])).toBe(false)
    expect(fs.readFileSync(path.join(root, 'pack.toml'), 'utf8')).toBe(firstPack)
    expect(fs.readFileSync(path.join(root, 'city.toml'), 'utf8')).toBe(firstCity)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses malformed managed blocks and unsafe identities', async () => {
    const { root, configurator } = fixture()
    fs.appendFileSync(path.join(root, 'pack.toml'), '\n# factoru-managed project sessions: begin\n')
    await expect(configurator.reconcile([project])).rejects.toThrow(/malformed/)
    await expect(
      configurator.reconcile([{ ...project, chatAgentName: '../escape' }]),
    ).rejects.toThrow(/Invalid chat agent name/)
  })

  it('rejects non-loopback agent-tool endpoints and runtime symlinks', async () => {
    const { root, prompt, executor } = fixture()
    expect(
      () =>
        new GasCityProjectConfigurator({
          cityPath: root,
          factoruServerUrl: 'https://factoru.example.com',
          projectManagerPromptPath: prompt,
          executor,
        }),
    ).toThrow(/bare HTTP loopback/)

    fs.symlinkSync(path.join(root, 'agents'), path.join(root, '.gc'))
    await expect(
      new GasCityProjectConfigurator({
        cityPath: root,
        factoruServerUrl: 'http://localhost:8787',
        projectManagerPromptPath: prompt,
        executor,
      }).reconcile([project]),
    ).rejects.toThrow(/Refusing to traverse runtime directory/)
  })
})
