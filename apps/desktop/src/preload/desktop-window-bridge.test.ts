import { describe, expect, it, vi } from 'vitest'
import { IPC_DESKTOP_WINDOW_CHANGED, IPC_DESKTOP_WINDOW_GET } from '../shared/desktop-window'
import { createDesktopWindowBridge } from './desktop-window-bridge'

describe('desktop window preload bridge', () => {
  it('exposes only platform, state, and a cleaned-up subscription', async () => {
    const invoke = vi.fn().mockResolvedValue({ fullScreen: false })
    const on = vi.fn()
    const off = vi.fn()
    const bridge = createDesktopWindowBridge({ invoke, on, off }, 'freebsd')
    expect(bridge.platform).toBe('linux')
    await expect(bridge.getState()).resolves.toEqual({ fullScreen: false })
    expect(invoke).toHaveBeenCalledWith(IPC_DESKTOP_WINDOW_GET)

    const listener = vi.fn()
    const cleanup = bridge.subscribe(listener)
    const handler = on.mock.calls[0]?.[1]
    handler({}, { fullScreen: true })
    expect(listener).toHaveBeenCalledWith({ fullScreen: true })
    cleanup()
    expect(off).toHaveBeenCalledWith(IPC_DESKTOP_WINDOW_CHANGED, handler)
  })
})
