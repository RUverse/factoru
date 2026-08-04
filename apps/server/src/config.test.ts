import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  ServerConfigError,
  defaultDataDir,
  loadServerConfig,
} from './config.js'

describe('server configuration', () => {
  it('binds localhost by default', () => {
    const config = loadServerConfig({ FACTORU_DATA_DIR: '/tmp/factoru-test' })
    expect(config.host).toBe(DEFAULT_HOST)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logLevel).toBe('info')
  })

  it('accepts a per-worktree data directory and port', () => {
    const config = loadServerConfig({
      FACTORU_DATA_DIR: '/tmp/factoru-test/worktree',
      FACTORU_PORT: '41234',
      FACTORU_HOST: '0.0.0.0',
      FACTORU_LOG_LEVEL: 'debug',
    })
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 41234,
      dataDir: '/tmp/factoru-test/worktree',
      logLevel: 'debug',
    })
  })

  it.each(['0', '65535'])('accepts the boundary port %s', (port) => {
    expect(loadServerConfig({ FACTORU_DATA_DIR: '/tmp/f', FACTORU_PORT: port }).port).toBe(
      Number(port),
    )
  })

  it.each(['-1', '65536', '1.5', 'eight', '0x10', '8080 8081'])('rejects the port %j', (port) => {
    expect(() => loadServerConfig({ FACTORU_DATA_DIR: '/tmp/f', FACTORU_PORT: port })).toThrow(
      ServerConfigError,
    )
  })

  it.each(['', ' '])('treats the blank port %j as unset', (port) => {
    expect(loadServerConfig({ FACTORU_DATA_DIR: '/tmp/f', FACTORU_PORT: port }).port).toBe(
      DEFAULT_PORT,
    )
  })

  it('rejects a relative data directory', () => {
    expect(() => loadServerConfig({ FACTORU_DATA_DIR: 'relative/state' })).toThrow(
      ServerConfigError,
    )
  })

  it('rejects an unknown log level', () => {
    expect(() =>
      loadServerConfig({ FACTORU_DATA_DIR: '/tmp/f', FACTORU_LOG_LEVEL: 'loud' }),
    ).toThrow(ServerConfigError)
  })

  it('uses a platform-appropriate default data directory', () => {
    expect(defaultDataDir('darwin', '/Users/test')).toBe(
      path.join('/Users/test', 'Library', 'Application Support', 'Factoru'),
    )
    expect(defaultDataDir('linux', '/home/test')).toContain('factoru')
  })
})
