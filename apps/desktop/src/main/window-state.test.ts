import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { IPC_DESKTOP_WINDOW_CHANGED } from '../shared/desktop-window'
import { bindWindowStateEvents } from './window-state'

describe('desktop fullscreen events', () => {
  it('publishes state changes and removes both listeners on cleanup', () => {
    const emitter = new EventEmitter()
    let fullScreen = false
    const send = vi.fn()
    const window = Object.assign(emitter, {
      isDestroyed: () => false,
      isFullScreen: () => fullScreen,
      webContents: { send },
    })
    const cleanup = bindWindowStateEvents(window)
    fullScreen = true
    emitter.emit('enter-full-screen')
    expect(send).toHaveBeenCalledWith(IPC_DESKTOP_WINDOW_CHANGED, { fullScreen: true })
    cleanup()
    emitter.emit('leave-full-screen')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
