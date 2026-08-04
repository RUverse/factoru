import { describe, expect, it } from 'vitest'
import { isLiveState, nextConnectionState, type ConnectionState } from './connection.js'

describe('connection state machine', () => {
  it('walks the local first-connection path', () => {
    let state: ConnectionState = 'unconfigured'
    state = nextConnectionState(state, { type: 'connect_requested' })!
    expect(state).toBe('connecting')
    state = nextConnectionState(state, { type: 'handshake_succeeded' })!
    expect(state).toBe('connected')
    expect(isLiveState(state)).toBe(true)
  })

  it('recovers from an unexpected disconnect', () => {
    let state = nextConnectionState('connected', { type: 'disconnected' })!
    expect(state).toBe('reconnecting')
    expect(isLiveState(state)).toBe(false)
    state = nextConnectionState(state, { type: 'handshake_succeeded' })!
    expect(state).toBe('connected')
  })

  it('blocks on an incompatible protocol until configuration changes', () => {
    const blocked = nextConnectionState('connecting', {
      type: 'handshake_blocked',
      reason: 'incompatible_protocol',
    })!
    expect(blocked).toBe('blocked')
    expect(nextConnectionState(blocked, { type: 'disconnected' })).toBeNull()
    expect(nextConnectionState(blocked, { type: 'configuration_changed' })).toBe('connecting')
  })

  it('returns from offline through reconnecting rather than straight to connected', () => {
    const offline = nextConnectionState('connected', { type: 'network_unavailable' })!
    expect(offline).toBe('offline')
    expect(nextConnectionState(offline, { type: 'handshake_succeeded' })).toBeNull()
    expect(nextConnectionState(offline, { type: 'network_returned' })).toBe('reconnecting')
  })

  it('ignores illegal events instead of resetting', () => {
    expect(nextConnectionState('unconfigured', { type: 'handshake_succeeded' })).toBeNull()
    expect(nextConnectionState('pairing', { type: 'network_returned' })).toBeNull()
  })

  it('always allows removing the server profile once configured', () => {
    const states: ConnectionState[] = [
      'pairing',
      'connecting',
      'connected',
      'reconnecting',
      'offline',
      'blocked',
    ]
    for (const state of states) {
      expect(nextConnectionState(state, { type: 'server_removed' })).toBe('unconfigured')
    }
  })
})
