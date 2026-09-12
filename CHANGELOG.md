# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Contributor Notes

#### Added

- Pure epoch-ms day/week boundary helpers (`app/src/shared/time.ts`), built on `date-fns` per BUILD_PLAN §5.5 — no hand-rolled DST arithmetic.
- Main-process SQLite connection singleton (`app/src/main/db/connection.ts`) with the required WAL / foreign key / busy-timeout pragmas.

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
