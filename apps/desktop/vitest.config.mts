import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/main/**/*.test.ts',
      'src/preload/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/renderer/src/**/*.test.{ts,tsx}',
    ],
  },
})
