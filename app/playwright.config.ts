import { defineConfig } from '@playwright/test'

// Electron integration tests (BUILD_PLAN §15): launch the real, built app
// against a seeded, isolated SQLite database, drive it through the UI, then
// reopen that same database file to assert the rows it ends up with. Local-
// only for now — run via `npm run test:e2e` after `npm run build` — with a
// workflow_dispatch GitHub Actions job (`.github/workflows/e2e.yml`) to run
// them on demand until the pattern proves stable enough for the PR gate.
export default defineConfig({
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
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // One project per renderer surface (not per tab — Tracker is the tray menu
  // + the four prompt windows, §8.2/§9, not a tab at all) so `--project=X`
  // scopes a run to what you're actually touching. `tracker`/`review` have
  // no spec files yet — their UI doesn't exist — and stay empty until it
  // does; Playwright is fine with a project matching zero tests.
  projects: [
    { name: 'configuration', testDir: './tests/e2e/configuration' },
    { name: 'tracker', testDir: './tests/e2e/tracker' },
    { name: 'review', testDir: './tests/e2e/review' }
  ]
})
