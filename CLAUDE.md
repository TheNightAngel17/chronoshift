## Project docs

- **Specification of record**: `docs/BUILD_PLAN.md`. Build to it. Where it is silent, prefer the simplest thing satisfying the stated invariants and leave a `// TODO(spec):` comment rather than inventing behaviour that contradicts it.
- **Glossary**: `CONTEXT.md` at the repo root. Use its terms; it lists the synonyms to avoid.
- The app itself lives in `app/`. Paths in `BUILD_PLAN.md` section 4 are app-relative.

## CHANGELOG.md

### Format
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version headers are `v`-prefixed (`## [v0.1.0]`) to match the git tag name exactly — the link footer below depends on this. Each version splits into two audience subsections:

- `### Release Notes` — what a user of the packaged app would notice. **Always present** on a version that's being cut, even with nothing to say (see below) — the release workflow extracts this subsection into the GitHub Release (bumping its `####` category headers to `##`, since the release page has no wrapping version/subsection levels to nest under), so it can't be omitted the way an empty category header can.
- `### Contributor Notes` — CI/CD, build tooling, dev-workflow changes a contributor cares about but a user never sees. Omit entirely when there's nothing to say, same as any other empty section.

Within each, entries group under `#### Added` / `#### Changed` / `#### Fixed` / `#### Removed` / `#### Deprecated` / `#### Security`, newest version first, dates as `YYYY-MM-DD`. Omit empty category headers rather than leaving them blank.

If a cycle has no user-facing changes, `### Release Notes` still appears on the cut version, holding one line — "No user-facing changes in this release." — instead of category headers. While a cycle is still `[Unreleased]`, omit a subsection entirely until it has real content, rather than carrying an empty placeholder.

### Every change gets an Unreleased entry
Any change worth noting gets a bullet under `## [Unreleased]` in the same commit/PR that makes the change, not backfilled later. Skip purely internal changes (refactors, test-only changes) that neither a user nor a contributor would notice. Sort what's left by audience: would an end user of the packaged app notice? → `### Release Notes`. Only a contributor would (CI/CD, build tooling, dev workflow) → `### Contributor Notes`. Write Release Notes entries in user-facing language describing what changed, not which file changed.

Before adding a new bullet, check whether Unreleased already has one for the same feature/area. If a feature was added, then fixed, then changed again, then fixed again — all before the next release — that's **one** entry, edited in place each time, not four. `[Unreleased]` should always read as the diff between the last released version and right now, never as a log of the individual commits that got you there. When a fix lands for something Unreleased already claims as `Added`/`Changed` this cycle, correct that existing bullet (and its wording) instead of appending a separate `Fixed` bullet — a `Fixed` entry belongs in Unreleased only when it fixes something that shipped in a *previous* release.

### Cutting a new version
1. Rename `## [Unreleased]` to `## [vX.Y.Z] - YYYY-MM-DD` and add a fresh, empty `## [Unreleased]` above it. Make sure the cut version has a `### Release Notes` subsection (add the "No user-facing changes in this release." line if it would otherwise be empty).
2. Update the link footer (see below).
3. `git tag -a vX.Y.Z -m "..."` on the release commit, then `git push origin vX.Y.Z`.

### Link footer
Each version header is a markdown link reference, resolved at the bottom of the file, using GitHub's `/compare/{base}...{head}` diff view:
- `[Unreleased]` always compares the newest tagged version against `HEAD`: `.../compare/vX.Y.Z...HEAD`.
- Every version *after* the first compares against the version immediately before it: `.../compare/vPREV...vX.Y.Z`.
- The very first version has nothing to diff against, so it links straight to the tag instead: `.../tree/vX.Y.Z`. Switch that to `.../releases/tag/vX.Y.Z` once the release workflow has published a GitHub Release for it.

Concretely, when v0.1.0 ships the footer becomes:
```
[Unreleased]: https://github.com/TheNightAngel17/chronoshift/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/TheNightAngel17/chronoshift/tree/v0.1.0
```

## Agent skills

### Issue tracker
GitHub Issues in this repository. See `docs/agents/issue-tracker.md`.

### Domain docs
Single-context layout: one root `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
