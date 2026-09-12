# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Contributor Notes

#### Added

- Pure epoch-ms day/week boundary helpers (`app/src/shared/time.ts`), built on `date-fns` per BUILD_PLAN §5.5 — no hand-rolled DST arithmetic.
- Shared domain types and IPC contract (`app/src/shared/types.ts`, `app/src/shared/ipc-contract.ts`) per BUILD_PLAN §11, importable unchanged from both the main and renderer processes.
- Main-process SQLite connection singleton (`app/src/main/db/connection.ts`) with the required WAL / foreign key / busy-timeout pragmas.
- Forward-only SQLite migration runner with `schema_meta` version tracking, plus initial schema/setup seeds for buckets, segments, check-ins, idle events, settings, and app state.
- Buckets repository CRUD logic, including transactional depth/cycle checks, recent-bucket queries, inherited color resolution, and clear delete errors for referenced buckets.
- Main-process bucket IPC handlers and registration for all `buckets:*` channels, including argument validation and `Result<T>` error mapping for depth/cycle/delete rejections.
- Main-process segments repository (`app/src/main/db/repositories/segments.ts`) enforcing the BUILD_PLAN §5.1/§5.2 timeline invariants (single open segment, no overlaps, watermark ranges) with `create`/`open`/`switch`/`update`/`split`/`merge`/`range`/`needsReview` primitives.
- Settings, check-ins, idle events, and app-state repositories (`app/src/main/db/repositories/{settings,checkins,idleEvents,appState}.ts`) providing typed CRUD and §7 settings validation over those tables.

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
