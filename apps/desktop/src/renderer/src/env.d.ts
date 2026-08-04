/// <reference types="vite/client" />

import type { FactoruBridge } from '../../shared/connection'

declare global {
  interface Window {
    /** Injected by the preload bridge; the only privileged API in the renderer. */
    readonly factoru: FactoruBridge
  }
}

export {}
