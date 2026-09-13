# Contributing

## Before you start

Read these, in order:

1. [CONTEXT.md](./CONTEXT.md) — the glossary. Use its terms; don't drift to the synonyms it lists as avoided.
2. [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) — the specification of record. Build to it. Where it's silent, prefer the simplest thing that satisfies its stated invariants and leave a `// TODO(spec):` comment rather than inventing behavior that contradicts it.
3. [docs/adr/](./docs/adr/) — why a contested choice went the way it did.

Planning happens on the issue tracker (GitHub Issues). The [wayfinder map](https://github.com/TheNightAngel17/chronoshift/issues/2) tracks what's still undecided; issues labelled `build` track what's still unbuilt. Check there before starting work that isn't already covered by an open issue.

## Setup

```
cd app
npm install
npm run dev
```

## Making a change

- Keep `docs/BUILD_PLAN.md` §3 (tech stack) and §4 (project structure) honest — if you move a path or add a dependency, update the doc in the same change.
- Don't substitute a stack choice listed in BUILD_PLAN §3 without a comment explaining why, and consider whether the decision needs an ADR (see below).
- Use the vocabulary in `CONTEXT.md` in code, comments, commits, and PR descriptions. If you need a term that isn't there, either you're inventing language the project doesn't use (reconsider) or there's a real gap — flag it rather than picking your own word.
- Write an ADR under `docs/adr/` only when a decision is hard to reverse, would be surprising without context, and involved a genuine trade-off. One paragraph is enough — the value is recording *that* the decision was made and *why*. Leave a one-line pointer from the `BUILD_PLAN.md` section it affects.

## Testing

Three tiers, broadest and cheapest first — put a new test in the lowest tier that can actually exercise it, since each tier up costs roughly an order of magnitude more to run:

1. **Unit** — `src/**/*.test.ts`, colocated with the code it tests. One unit of code against itself: no database, no Electron, no filesystem. Runs under `vitest`.
2. **Integration** — `src/**/*.integration.test.ts`, colocated the same way. One unit of code against a real local dependency — a real (in-memory or temp-file) sqlite database via `better-sqlite3`, no Electron. This is where repository and IPC-handler business rules belong (depth/cycle checks, delete-if-unused, color inheritance, and so on) — it's fast enough that "test everything a user can do" mostly belongs here, not at the e2e tier. Also runs under `vitest`; `npm run test:unit` / `npm run test:integration` scope to one tier, `npm run test:run` runs both.
3. **E2e** — `app/tests/e2e/`, one Playwright `project` per renderer surface (see `playwright.config.ts`; currently `configuration`, `tracker`, `review` — mapped to what's actually a distinct UI surface, not 1:1 with main-window tabs). Launches the real built app against a seeded, isolated database, drives it through the UI, then reopens that database file to assert what actually got written. Deliberately the thin top of the pyramid: a handful of realistic multi-step flows per area (seed → launch → interact/assert × N → cleanup), each hitting every relevant affordance at least once in a plausible sequence — not a combinatorial sweep of every button at every tree depth, and not a re-test of business rules already covered at the integration tier. Run via `npm run test:e2e` (`--project=<name>` to scope one area) after `npm run build`; local-only for now (`.github/workflows/e2e.yml` is `workflow_dispatch`-only), not part of the CI gate.

See [BUILD_PLAN §15](./docs/BUILD_PLAN.md#15-testing-notes) for what's specific to this app rather than the taxonomy itself (which unit tests are worth writing beyond ordinary coverage, what each e2e project actually spans).

## Before opening a pull request

From `app/`:

```
npm run lint
npm run typecheck
npm run test:run
npm run build
```

These are exactly what [CI](./.github/workflows/ci.yml) runs, scoped to changes under `app/`. A PR that doesn't touch `app/` (or `ci.yml` itself) skips the build/test job entirely.

## Pull requests

- Target `main`.
- Keep the diff scoped to one change; unrelated cleanup belongs in its own PR.
- Reference the issue the PR resolves, if there is one.
- Update [CHANGELOG.md](./CHANGELOG.md) under `[Unreleased]` in the same PR for any change worth noting — see [CLAUDE.md](./CLAUDE.md#changelogmd) for the exact format (each version splits into `### Release Notes` and `### Contributor Notes`) and the "edit the existing bullet, don't append a new one" rule for changes within the same release cycle.

## Commit messages

Short, imperative summary line. Explain *why* in the body when it isn't obvious from the diff; the diff already shows *what* changed.

## CI/CD

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every pull request and every push to `main`. It's three jobs:

1. **`ci-build-test-check-dir`** — cheap, runs first, diffs the incoming changes against their base and checks whether anything under `app/` or `ci.yml` itself changed.
2. **`windows-ci-build-test`** — install, lint, typecheck, test, build, on `windows-latest` (matching the primary shipping target from [BUILD_PLAN §1](./docs/BUILD_PLAN.md)). Skipped entirely when the first job found nothing relevant changed (a docs-only PR, for example), so those merge fast.
3. **`ci-build-test-gate`** — always runs regardless of what the other two did, and is the job meant to act as the required status check: it reports a real pass/fail either way, so a skipped build job still gates green instead of leaving the PR stuck waiting on a check that never ran.

If you're touching `ci.yml` itself, that counts as a relevant change — the pipeline always runs for real on changes to its own file.

## Releasing

1. Rename `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`, add a fresh empty `## [Unreleased]` above it, and update the compare-link footer at the bottom of the file (full steps in [CLAUDE.md](./CLAUDE.md#changelogmd)).
2. Merge that to `main`, then tag the release commit and push the tag:
   ```
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
3. Pushing the tag triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml), which builds the Windows NSIS installer and publishes it to a GitHub Release, with release notes pulled straight from that version's `### Release Notes` section in `CHANGELOG.md`.

Releases are **unsigned** — see [BUILD_PLAN](./docs/BUILD_PLAN.md) §13 for why — so installers trigger a Windows SmartScreen warning ("More info" → "Run anyway" to proceed). This is a deliberate, documented trade-off, not an oversight.
