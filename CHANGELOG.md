# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Contributor Notes

#### Added

- Bootstrapped the Electron app shell (main/preload/renderer, tray icon, main window tab scaffold).
- Project documentation: `docs/BUILD_PLAN.md` (specification of record), `CONTEXT.md` (glossary), `CONTRIBUTING.md`, and an MIT `LICENSE`.
- `CHANGELOG.md` now splits each version into `### Release Notes` and `### Contributor Notes` sections; see [`CLAUDE.md`](./CLAUDE.md#changelogmd) for the format and release-cut process.
- CI workflow (`.github/workflows/ci.yml`, replacing `pr-gate.yml`): change-detection, then lint/typecheck/test/build on `windows-latest` — matching the app's primary shipping target — then a gate job, on every pull request and push to `main`.
- Release workflow (`.github/workflows/release.yml`): pushing a `vX.Y.Z` tag builds the Windows NSIS installer and publishes it to a GitHub Release, with release notes pulled from the matching `CHANGELOG.md` version section. Installers are unsigned, so Windows SmartScreen will warn on first run.

[Unreleased]: https://github.com/TheNightAngel17/chronoshift/compare/main...HEAD
