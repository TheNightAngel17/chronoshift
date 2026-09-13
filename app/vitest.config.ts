import { defineConfig } from 'vitest/config'

// Three test tiers in this repo (CONTRIBUTING.md, BUILD_PLAN §15):
//   1. unit        — src/**/*.test.ts, excluding integration (no DB, no Electron)
//   2. integration — src/**/*.integration.test.ts             (real sqlite, no Electron)
//   3. e2e         — tests/e2e/**/*.spec.ts (real built app — Playwright,
//                    see playwright.config.ts; a different test()/runner,
//                    never picked up by Vitest's default glob)
//
// `npm run test:unit` / `test:integration` run one project via `--project`;
// plain `vitest run` (npm run test:run) runs both together, same as before
// this file existed.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts']
        }
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts']
        }
      }
    ]
  }
})
