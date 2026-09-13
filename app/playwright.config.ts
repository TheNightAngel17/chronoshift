import { defineConfig } from '@playwright/test'

// Electron integration tests (BUILD_PLAN §15): launch the real, built app
// against a seeded, isolated SQLite database, drive it through the UI, then
// reopen that same database file to assert the rows it ends up with. Local-
// only for now — run via `npm run test:e2e` after `npm run build` — with a
// workflow_dispatch GitHub Actions job (`.github/workflows/e2e.yml`) to run
// them on demand until the pattern proves stable enough for the PR gate.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // Each test launches its own Electron process against its own temp
  // userData dir, so tests are already isolated from each other — but
  // Electron/Chromium processes are heavy, and running several at once on a
  // CI runner (or a laptop) invites flakiness for little benefit at this
  // suite's size. Revisit if the suite grows large enough that serial
  // runtime becomes the bottleneck.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list'
})
