import { describe, expect, it } from 'vitest'
import { parseCliArgs, renderCliHelp } from './cli.js'

describe('Factoru Server CLI parser', () => {
  it('defaults to foreground start and exposes version/help', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'start' })
    expect(parseCliArgs(['start'])).toEqual({ kind: 'start' })
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' })
    expect(renderCliHelp()).toContain('providers configure')
  })

  it('parses provider configuration and requires a selected default', () => {
    expect(
      parseCliArgs([
        'providers',
        'configure',
        '--provider',
        'claude',
        '--provider',
        'codex',
        '--default-provider',
        'codex',
      ]),
    ).toEqual({
      kind: 'providers-configure',
      providers: ['claude', 'codex'],
      defaultProvider: 'codex',
    })
    expect(() => parseCliArgs(['providers', 'configure'])).toThrow('Choose at least one')
    expect(() =>
      parseCliArgs([
        'providers',
        'configure',
        '--provider',
        'claude',
        '--default-provider',
        'codex',
      ]),
    ).toThrow('must also be supplied')
  })

  it('accepts only supported providers', () => {
    expect(parseCliArgs(['doctor', '--provider', 'codex'])).toEqual({
      kind: 'doctor',
      provider: 'codex',
    })
    expect(() => parseCliArgs(['doctor', '--provider', 'gemini'])).toThrow('codex or claude')
  })

  it('validates safe SSH pairing output options', () => {
    expect(
      parseCliArgs(['pair', '--ssh-host', 'rez@rez-pi.local', '--local-port', '18788', '--json']),
    ).toEqual({
      kind: 'pair',
      sshHost: 'rez@rez-pi.local',
      localPort: 18788,
      json: true,
    })
    expect(() => parseCliArgs(['pair', '--ssh-host', 'host;reboot'])).toThrow('--ssh-host')
    expect(() => parseCliArgs(['pair', '--local-port', '0'])).toThrow('--local-port')
  })

  it('parses status/session machine output and absolute backups', () => {
    expect(parseCliArgs(['status', '--json'])).toEqual({ kind: 'status', json: true })
    expect(parseCliArgs(['sessions', '--active', '--json'])).toEqual({
      kind: 'sessions',
      activeOnly: true,
      json: true,
    })
    expect(parseCliArgs(['backup', '/tmp/factoru.sqlite'])).toEqual({
      kind: 'backup',
      destination: '/tmp/factoru.sqlite',
    })
    expect(() => parseCliArgs(['backup', 'relative.sqlite'])).toThrow('absolute')
  })
})
