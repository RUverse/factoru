import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Electron's three trust levels are three separate bundles.
 *
 * electron-vite externalizes everything listed in `dependencies`, so the shared
 * Factoru packages are declared as devDependencies and bundled into the output.
 * A packaged application therefore carries no dependency on the monorepo layout.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    plugins: [react()],
    server: {
      port: Number(process.env.FACTORU_RENDERER_PORT ?? 5173),
      strictPort: true,
    },
  },
})
