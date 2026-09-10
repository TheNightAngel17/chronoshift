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

## Before opening a pull request

From `app/`:

```
npm run lint
npm run typecheck
npm run test:run
npm run build
```

These are exactly what the [PR gate](./.github/workflows/pr-gate.yml) runs, scoped to changes under `app/`. A PR that doesn't touch `app/` skips CI entirely.

## Pull requests

- Target `main`.
- Keep the diff scoped to one change; unrelated cleanup belongs in its own PR.
- Reference the issue the PR resolves, if there is one.
- Update [CHANGELOG.md](./CHANGELOG.md) under `[Unreleased]` for any user-facing change (new feature, fix, or breaking change) — see that file for format.

## Commit messages

Short, imperative summary line. Explain *why* in the body when it isn't obvious from the diff; the diff already shows *what* changed.
