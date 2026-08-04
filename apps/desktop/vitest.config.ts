import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Only main-process logic is unit tested at this milestone; renderer
    // behavior is covered once the product shell exists.
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
  },
})
