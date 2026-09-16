# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Release Notes

#### Added

- The Configuration tab now has a bucket tree editor: create buckets, rename them, move them up and down, reparent them, pick their color, archive them, and delete the ones no time has been tracked against. Nesting stops at four levels, and the built-in "Break / Away" bucket only lets you change its color.

### Contributor Notes

#### Fixed

- The preload script failed to load under `sandbox: true` (`Error: module not found: @electron-toolkit/preload`), silently leaving `window.api` undefined in every renderer window — invisible until this cycle's bucket tree editor became the first code to actually call it. electron-vite's default dependency-externalization treated `@electron-toolkit/preload` as an external `require()`, which a sandboxed preload script can't resolve; `electron.vite.config.ts` now excludes it so it gets bundled into the preload output instead.

#### Added

- Tracking state machine (`app/src/main/services/tracking.ts`) implementing BUILD_PLAN §5.1/§5.2/§5.3's timeline and watermark rules as a pure `(state, event) => { state, writes }` reducer over issue #7's transition table — exactly two states (`not_tracking`/`tracking`, so a break is just a switch to the system break bucket per ADR 0001), an orthogonal `idleUnresolved` flag, every backdate routed through `shared/clamp.ts`, and a declarative write list for a later issue to apply transactionally. Covered by BUILD_PLAN §15.1's `fast-check` property test (a new test-only devDependency) asserting the §5.1 invariants after every step of a long random transition sequence, plus §5.2's worked example as an explicit case.
- Main-process tracking and segment IPC handlers (`app/src/main/ipc/handlers/tracking.ts`, `app/src/main/ipc/handlers/segments.ts`, with the shared handler plumbing lifted into `app/src/main/ipc/handlers/common.ts`) backing BUILD_PLAN §11's `tracking:*` and `segments:*` channels. The tracking handlers are the impure shell around issue #39's pure reducer: each call rebuilds the machine state from the database, reduces the event, and applies the resulting writes through the segments repository in one transaction; the segment handlers are thin wrappers over that repository's `range`/`create`/`update`/`split`/`merge`/`delete`/`needsReview`. Every mutating call broadcasts `tracking:changed` / `segments:changed`, and preload now exposes `window.api.tracking` and `window.api.segments` (including their `onChanged` subscriptions). No UI consumes them yet. `idle:*` and `recovery:*` remain unimplemented.
- Formalized the three-tier testing taxonomy (CONTRIBUTING.md, BUILD_PLAN §15) — unit (`src/**/*.test.ts`), integration (`src/**/*.integration.test.ts`, real sqlite, no Electron; the existing DB/IPC-handler tests are renamed onto this convention), and e2e — and added the e2e tier: a Playwright-based Electron test harness (`app/tests/e2e/`, `app/playwright.config.ts`) that seeds an isolated SQLite database, launches the real built app, drives it through the UI, then reopens that database file to assert the rows it actually wrote. One Playwright `project` per renderer surface (`configuration`, `tracker`, `review` — mapped to actual UI surfaces, not tabs) so `--project=<name>` scopes a run. Run locally via `npm run test:e2e`; a `workflow_dispatch`-only Actions workflow (`.github/workflows/e2e.yml`) runs the suite on demand. Not part of the PR gate yet. First coverage, as several realistic multi-step flows rather than one test per affordance: building simple and 4-level bucket trees (plus the depth-4 refusal), reparenting across branches and reordering, renaming/coloring (including the sibling-name-swap-on-conflict behavior), the system break bucket's guards, and deletion (including the delete-with-children error message).
- Pure epoch-ms day/week boundary helpers (`app/src/shared/time.ts`), built on `date-fns` per BUILD_PLAN §5.5 — no hand-rolled DST arithmetic.
- Backdate clamping helper (`app/src/shared/clamp.ts`) implementing BUILD_PLAN §5.6's ordered clamp-to-now / floor-to-previous-segment / snap-to-now pipeline, as resolved by issue #10 — the single source of truth the tracking reducer and `SinceWhenInput` will both call into so the rule is enforced in the main process, not just the UI.
- Shared domain types and IPC contract (`app/src/shared/types.ts`, `app/src/shared/ipc-contract.ts`) per BUILD_PLAN §11, importable unchanged from both the main and renderer processes.
- Main-process SQLite connection singleton (`app/src/main/db/connection.ts`) with the required WAL / foreign key / busy-timeout pragmas.
- Forward-only SQLite migration runner with `schema_meta` version tracking, plus initial schema/setup seeds for buckets, segments, check-ins, idle events, settings, and app state.
- Buckets repository CRUD logic, including transactional depth/cycle checks, recent-bucket queries, inherited color resolution, and clear delete errors for referenced buckets.
- Main-process bucket IPC handlers and registration for all `buckets:*` channels, including argument validation and `Result<T>` error mapping for depth/cycle/delete rejections.
- Main-process segments repository (`app/src/main/db/repositories/segments.ts`) enforcing the BUILD_PLAN §5.1/§5.2 timeline invariants (single open segment, no overlaps, watermark ranges) with `create`/`open`/`switch`/`update`/`split`/`merge`/`range`/`needsReview` primitives.
- Settings, check-ins, idle events, and app-state repositories (`app/src/main/db/repositories/{settings,checkins,idleEvents,appState}.ts`) providing typed CRUD and §7 settings validation over those tables.
- The shared prompt window shell (`app/src/main/windows/promptWindow.ts`, `app/src/renderer/prompt.html` + `prompt-app/App.tsx`) and its arbitration queue (`app/src/main/services/promptQueue.ts`), implementing decision ticket #8's Recovery > Idle > Checkin strict-priority model: a higher-priority prompt forcibly closes and times out whatever's on screen, and a `checkins` row is only ever created at the moment a check-in is actually displayed. No producer wires into it yet (the check-in scheduler is issue #43), so nothing user-visible changes this cycle. Preload gained a `prompts.onShow` event subscription (and the `IpcEventSubscriber` type it's built on) as the first main → renderer event forwarding in the app.
- The check-in scheduler (`app/src/main/services/scheduler.ts`), implementing BUILD_PLAN §8.3 and decision ticket #8's reschedule-rule resolution: a self-correcting timer (recomputes the delay from a fixed target timestamp on every tick, and exposes `reevaluate()` for a caller to re-arm it after system resume) that requests the Checkin slot from `promptQueue.ts` at `now + checkin_interval_minutes` after a segment opens, reschedules fresh from confirm/switch, reschedules at `snooze_minutes` after a snooze, and never requests the slot while no segment is open or idle is unresolved (the latter via a stubbed `isIdleUnresolved()` seam Phase 6 will wire to the real idle monitor). Nothing calls it yet — the tracking-state and idle-monitor producers it needs land in later issues — so this is scaffolding with no user-visible effect this cycle.

#### Removed

- The broken `postinstall` rebuild step, so `better-sqlite3` v13 uses its bundled prebuilds as intended instead of forcing a source build.

## [v0.0.0] - 2026-09-10

### Release Notes

No user-facing changes in this release.

### Contributor Notes

#### Added

- Bootstrapped the Electron app shell (main/preload/renderer, tray icon, main window tab scaffold).
- Project documentation: `docs/BUILD_PLAN.md` (specification of record), `CONTEXT.md` (glossary), `CONTRIBUTING.md`, and an MIT `LICENSE`.
- `CHANGELOG.md` now splits each version into `### Release Notes` and `### Contributor Notes` sections; see [`CLAUDE.md`](./CLAUDE.md#changelogmd) for the format and release-cut process.
- CI workflow (`.github/workflows/ci.yml`, replacing `pr-gate.yml`): change-detection, then lint/typecheck/test/build on `windows-latest` — matching the app's primary shipping target — then a gate job, on every pull request and push to `main`.
- Release workflow (`.github/workflows/release.yml`): pushing a `vX.Y.Z` tag builds the Windows NSIS installer and publishes it to a GitHub Release, with release notes pulled from the matching `CHANGELOG.md` version section. Installers are unsigned, so Windows SmartScreen will warn on first run.

[Unreleased]: https://github.com/TheNightAngel17/chronoshift/compare/v0.0.0...HEAD
[v0.0.0]: https://github.com/TheNightAngel17/chronoshift/tree/v0.0.0
