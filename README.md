# ChronoShift

A simplistic local time-tracking app. No "second-by-second recording", all data stored locally (unless specifically exported / pushed), and lightweight. Just enough to track what you're working on, and nothing more.

## Documentation

| Document | What it holds |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | The glossary — what the words mean |
| [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) | The specification of record — what to build |
| [docs/adr/](./docs/adr/) | Why a contested choice went the way it did |
| [docs/agents/](./docs/agents/) | How agent skills consume this repo |

Planning happens on the issue tracker. The [wayfinder map](https://github.com/TheNightAngel17/chronoshift/issues/2) tracks what is still undecided; issues labelled `build` track what is still unbuilt.

## Development

The Electron app lives in [`app/`](./app/).

```
cd app
npm install
npm run dev
```
