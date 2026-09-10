## Project docs

- **Specification of record**: `docs/BUILD_PLAN.md`. Build to it. Where it is silent, prefer the simplest thing satisfying the stated invariants and leave a `// TODO(spec):` comment rather than inventing behaviour that contradicts it.
- **Glossary**: `CONTEXT.md` at the repo root. Use its terms; it lists the synonyms to avoid.
- The app itself lives in `app/`. Paths in `BUILD_PLAN.md` section 4 are app-relative.

## Agent skills

### Issue tracker
GitHub Issues in this repository. See `docs/agents/issue-tracker.md`.

### Domain docs
Single-context layout: one root `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
