import { defineConfig } from 'vitest/config'

// Scoped explicitly so Vitest's default `**/*.{test,spec}.ts` glob never picks
// up `tests/e2e/**` — those are Playwright specs (a different `test()`, a
// different runner) that launch the real Electron app rather than importing
// modules in-process. See `playwright.config.ts` for that suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
