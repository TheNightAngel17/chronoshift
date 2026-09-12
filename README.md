# ChronoShift

A simplistic local time-tracking app. No "second-by-second recording", all data stored locally (unless specifically exported / pushed), and lightweight. Just enough to track what you're working on, and nothing more.

It runs in the system tray, periodically asks what you're working on, and lets you review and correct your week afterwards. Windows is the primary target for v1; see [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) for the full spec.

**Status**: pre-release, under active development. No builds are published yet.

## Tech stack

Electron + TypeScript (`strict`) + React 19 + better-sqlite3, built with electron-vite and packaged with electron-builder. See [docs/BUILD_PLAN.md §3](./docs/BUILD_PLAN.md#3-tech-stack) for the full list and the reasoning behind each choice.

## Documentation

| Document | What it holds |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | The glossary — what the words mean |
| [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) | The specification of record — what to build |
| [docs/adr/](./docs/adr/) | Why a contested choice went the way it did |
| [docs/agents/](./docs/agents/) | How agent skills consume this repo |
| [CHANGELOG.md](./CHANGELOG.md) | Notable changes, release by release |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | How to set up, make, and submit a change |

Planning happens on the issue tracker. The [wayfinder map](https://github.com/TheNightAngel17/chronoshift/issues/2) tracks what is still undecided; issues labelled `build` track what is still unbuilt.

## Development

The Electron app lives in [`app/`](./app/).

```
cd app
npm install
npm run dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, including lint/typecheck/test/build commands and PR expectations.

## License

[MIT](./LICENSE)
