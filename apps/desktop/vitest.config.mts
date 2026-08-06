import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Main-process and preload contracts stay in Node; renderer behavior is
    // exercised through build/type coverage until a DOM harness is introduced.
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
  },
})
