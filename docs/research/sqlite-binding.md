# SQLite binding: `node:sqlite` vs `better-sqlite3`

Research for [issue #4](https://github.com/TheNightAngel17/chronoshift/issues/4). Resolves the question raised
against BUILD_PLAN §3 (which picks `better-sqlite3`) and §13 (which calls the native-module rebuild "the single
most common way an Electron + SQLite app works in dev and dies in production").

**Recommendation: keep `better-sqlite3`, and delete the `postinstall` that runs `electron-builder install-app-deps`.**

The premise the ticket was raised on no longer holds. `better-sqlite3` v13 is a Node-API addon that ships
prebuilt binaries inside its own npm tarball; it loads in Electron 39 with no rebuild, no `electron-rebuild`,
and no C++ toolchain. The ABI-rebuild risk §13 warns about is already gone. What is *not* gone is the
`postinstall` §13 prescribes to manage that risk — and that script is now the only thing in the chain that
actually fails on a clean machine.

---

## Method and trust level

Every claim below is either from a first-party document or was executed locally. Two runtimes were used and
they are **not** interchangeable:

| Runtime | Version | Bundled SQLite | Role |
|---|---|---|---|
| Local Node.js (developer machine) | **v24.0.2** | 3.49.1 | convenience only — **not** what ships |
| Electron 39.2.6 main process | Node **22.21.1** | **3.50.4** | the runtime that actually matters |

All behavioural results in this document were produced by running probe scripts **inside the Electron 39.2.6
main process** on Windows 11 x64 (`node_modules/electron/dist/electron.exe probe.js`), not under local Node.
Where local Node was used it is called out explicitly. Local Node 24.0.2 bundles SQLite **3.49.1**, which is a
*different build* from the 3.50.4 Electron 39 ships — anything verified only under local Node would not be
evidence about the shipped app.

Platform caveat: everything executed was **Windows x64 only**. macOS and Linux were not exercised.

---

## 1. Which Node does Electron 39 ship, and what is `node:sqlite`'s status there?

**Electron 39.2.6 ships Node.js 22.21.1** (Chromium 142.0.7444.226, V8 14.2.231.21, native module ABI 140).

Sources: [releases.electronjs.org/release/v39.2.6](https://releases.electronjs.org/release/v39.2.6), corroborated
against the full [releases.json](https://releases.electronjs.org/releases.json) feed and confirmed at runtime by
reading `process.versions` inside the Electron 39.2.6 main process. Across all 87 published 39.x releases the
Node version ranges from 22.16.0 to 22.22.1 — **the entire Electron 39 line is on Node 22**, so the app would
ride Node 22's `node:sqlite` for the whole life of this Electron major.

**Stability status is the important part, and it differs by Node major:**

- Node **22** docs (what Electron 39 ships): *"Stability: 1.1 - Active development."*
  ([nodejs.org/docs/latest-v22.x/api/sqlite.html](https://nodejs.org/docs/latest-v22.x/api/sqlite.html))
- Node **current** docs: *"Stability: 1.2 - Release candidate"* — but the version history records
  *"v25.7.0: SQLite is now a release candidate."*
  ([nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html))

So the release-candidate promotion landed in **Node 25.7.0**, which Electron 39 does not have and will never
get. On Electron 39 the module is Stability 1.1, "Active development" — the tier where breaking changes are
expected between minors.

The `--experimental-sqlite` flag requirement was removed in Node v23.4.0 / v22.13.0, so no flag is needed on
Electron 39. Electron does not compile the module out: Node's `node.gni` defaults `node_use_sqlite = true`
([nodejs/node v22.21.1 node.gni](https://github.com/nodejs/node/blob/v22.21.1/node.gni)) and the only reference
to that flag in the Electron tree is in `patches/node/build_add_gn_build_files.patch`, which passes it through
unchanged. Electron issue [#45532](https://github.com/electron/electron/issues/45532) ("Enable node:sqlite in
Electron 35") is closed as completed.

**Verified directly:** `require('node:sqlite')` inside the Electron 39.2.6 main process returns
`{ DatabaseSync, StatementSync, backup, constants }`. It works.

It also emits, on stderr, on every run:

```
(node:33860) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

## 2. Pragmas — `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`

**Yes, all three.** Verified in the Electron 39.2.6 main process:

| Pragma (§6) | Set via | Read back |
|---|---|---|
| `PRAGMA journal_mode = WAL` | `db.exec` / `db.prepare().get()` | `wal` |
| `PRAGMA foreign_keys = ON` | `db.exec` | `1` |
| `PRAGMA busy_timeout = 5000` | `db.exec` / `db.prepare().get()` | `5000` |

`-wal` and `-shm` files were confirmed present on disk, and `PRAGMA wal_checkpoint(TRUNCATE)` returned a normal
result row. Foreign keys were confirmed *enforced*, not merely reported on: inserting a `segments` row with a
non-existent `bucket_id` raised `FOREIGN KEY constraint failed` (`code: ERR_SQLITE_ERROR`, `errcode: 787`), and
`ON DELETE RESTRICT` blocked deleting a referenced bucket. The setting persisted inside a transaction.

Two conveniences worth knowing: `DatabaseSync` also accepts `enableForeignKeyConstraints` (default **`true`**)
and `timeout` (busy timeout in ms, default `0`) as constructor options, so two of the three pragmas can be set
at construction. `journal_mode` still has to be a statement. There is no `db.pragma()` helper — you use
`exec()`/`prepare()`.

## 3. Synchronous API and transaction control

**Synchronous: yes, fully.** `DatabaseSync` and `StatementSync` are synchronous by construction —
`run()`, `get()`, `all()`, `iterate()` all return values directly. This satisfies §14's main-process-only,
behind-a-repository requirement exactly as `better-sqlite3` does.

**Transaction control: available, but there is no `db.transaction(fn)` equivalent.** This is the single
real ergonomic loss. `node:sqlite` gives you the primitives and you write the wrapper:

```js
// what replaces better-sqlite3's db.transaction(fn)
function tx(db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
```

Verified in Electron 39: `BEGIN` / `COMMIT` / `ROLLBACK` and `BEGIN IMMEDIATE` all work through `exec()`;
rollback genuinely reverted an update; `db.isTransaction` correctly reported `true` inside and `false` after;
and `SAVEPOINT` / `ROLLBACK TO` / `RELEASE` work, so nested transactions are expressible.

What `better-sqlite3` gives you that the snippet above does not:

- **Automatic savepoint nesting.** Per its [API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md):
  *"Transaction functions can be called from inside other transaction functions. When doing so, the inner
  transaction becomes a savepoint. If an error is thrown inside of a nested transaction function, the nested
  transaction function will roll back to the state just before the savepoint and rethrow the error."*
  The naive wrapper above throws `cannot start a transaction within a transaction` if it nests.
- **`.deferred` / `.immediate` / `.exclusive` variants** on the same transaction function.

This matters more than it looks, because §5.1's invariants are enforced in the repositories and §14 requires
*every* multi-statement mutation to be wrapped. Repository methods calling other repository methods is exactly
the nesting case. It is perhaps 20–30 lines to reimplement savepoint nesting correctly on `node:sqlite`, and
it is code the project would then own and have to test.

## 4. Schema features — the `CASE` and `COALESCE` indexes

**Both work.** These are engine features and both engines are far past the requirement:

- Partial indexes: SQLite **3.8.0** (2013-08-26) — [sqlite.org/partialindex.html](https://www.sqlite.org/partialindex.html)
- Indexes on expressions: SQLite **3.9.0** (2015-10-14) — [sqlite.org/expridx.html](https://www.sqlite.org/expridx.html)

Bundled versions: **Electron 39's `node:sqlite` → SQLite 3.50.4**; **`better-sqlite3` v13.0.3 → SQLite 3.53.4**.
(The 3.50.4 figure was read from `process.versions.sqlite` and `sqlite_version()` inside Electron 39, and
independently from `deps/sqlite/sqlite3.h` at the [nodejs/node v22.21.1 tag](https://github.com/nodejs/node/blob/v22.21.1/deps/sqlite/sqlite3.h),
which defines `SQLITE_VERSION "3.50.4"`.)

Executed verbatim against `node:sqlite` in Electron 39, both index definitions from §6 created without error
**and enforced**:

```
PASS  UNIQUE INDEX over COALESCE(parent_id,-1) WHERE is_archived = 0
      -> duplicate sibling name rejected: UNIQUE constraint failed: index 'idx_buckets_sibling_name'
PASS  partial UNIQUE INDEX over CASE expression
      -> second open segment rejected: UNIQUE constraint failed: index 'idx_segments_single_open'
```

That is the §5.1 "at most one open segment" defence-in-depth working as designed. Also confirmed working:
`RETURNING`, named parameters, `iterate()`, and user-defined functions via `db.function()`.

One detail for whoever writes the repositories: `run()` returns `changes` and `lastInsertRowid` as
**`number`** by default (not BigInt) unless `readBigInts` is enabled.

## 5. Packaging — is the `asarUnpack` / `install-app-deps` claim true?

**The claim is true for `node:sqlite` and, surprisingly, mostly true for `better-sqlite3` v13 as well.**

For `node:sqlite`: correct, trivially. It is compiled into the Electron binary. There is no `.node` file, no
`node_modules` entry, nothing to unpack and nothing to rebuild.

For `better-sqlite3`, the situation has changed since BUILD_PLAN was written:

- **v13.x is a Node-API addon.** `binding.gyp` defines `NAPI_VERSION=10`. Node-API is
  [ABI-stable by contract](https://nodejs.org/api/n-api.html): *"modules compiled for one major version [run] on
  later major versions of Node.js without recompilation."* Node-API 10 requires Node ≥ 22.14.0; Electron 39
  ships 22.21.1, so it qualifies.
- **v13.x ships prebuilds inside the npm tarball**, named by platform/arch only (`prebuilds/win32-x64.node`,
  `prebuilds/darwin-arm64.node`, …) with no ABI in the filename. There are **zero** GitHub release assets for
  v13.0.0–v13.0.3 and no `install` script; v12.12.0, by contrast, published 145 ABI-specific assets
  (`better-sqlite3-v12.12.0-electron-v140-win32-x64.tar.gz` etc.). The delivery model changed.
- `binding.gyp` is a no-op when a prebuild exists for the host, so npm's implicit `node-gyp rebuild` does nothing.

**Verified end to end on Windows x64:**

1. `npm install better-sqlite3@13.0.3` completed in ~1s with **no compiler present** on the machine.
2. `require('better-sqlite3')` inside the Electron 39.2.6 main process succeeded **with no rebuild of any kind**,
   and ran `pragma('journal_mode = WAL')`, `foreign_keys`, `busy_timeout`, the `CASE` expression index, and
   `db.transaction()` correctly.
3. A real `electron-builder --dir` package was produced and the app loaded `better-sqlite3` from the built
   `app.asar` layout: `better-sqlite3: LOADED from packaged app, no rebuild; sqlite=3.53.4`.

**And the part that reverses the ticket's assumption — the prescribed `postinstall` is what breaks.**
Running BUILD_PLAN §13's own command in that same working project:

```
$ electron-builder install-app-deps
  • executing @electron/rebuild  electronVersion=39.2.6 arch=x64 buildFromSource=false
  • preparing       moduleName=better-sqlite3 arch=x64
  ⨯ Error: Could not find any Visual Studio installation to use
  ⨯ node-gyp failed to rebuild '...\node_modules\better-sqlite3'
```

`better-sqlite3` v13 does not declare a `binary`/`napi_versions` field in its `package.json`, so
`@electron/rebuild` does not recognise it as a Node-API module and tries to compile it from source — which
needs MSVC. The shipped prebuild that would have worked perfectly is ignored. **The mitigation is now the
failure mode.**

On `asarUnpack`: electron-builder's `smartUnpack` (default `true`) handles it. Per
[electron.build/docs/contents](https://www.electron.build/docs/contents/): *"When enabled, electron-builder
automatically detects executables and native modules and unpacks them from ASAR… You generally don't need to
configure `asar.unpack` manually."* Confirmed — the real build unpacked all eight `.node` files to
`app.asar.unpacked/node_modules/better-sqlite3/prebuilds/` without the explicit `asarUnpack: ["**/*.node"]`
entry being needed.

Note also that `better-sqlite3`'s own
[troubleshooting doc](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md) still says
*"If you're using Electron, use `electron-rebuild`"* — that advice predates the v13 Node-API switch and is what
`install-app-deps` is mechanically doing. It is now counterproductive.

**One real cost of `better-sqlite3` v13:** the tarball carries prebuilds for *all* platforms, and
electron-builder unpacks all of them. The Windows x64 build shipped **17 MB** of `.node` files where only
`win32-x64.node` (1.9 MB) is reachable — roughly 15 MB of dead weight per installer unless the `files` config
excludes the other platforms.

## 6. What is lost by moving to `node:sqlite`, and does §6–§11 need it?

| `better-sqlite3` capability | `node:sqlite` equivalent | Needed by §6–§11? |
|---|---|---|
| `db.transaction(fn)` with **automatic savepoint nesting** and `.deferred/.immediate/.exclusive` | none — hand-roll on `BEGIN`/`COMMIT`/`ROLLBACK` + `SAVEPOINT`; primitives verified working | **Yes.** §14 mandates transactions for every multi-statement mutation and §5.1's invariants depend on them. This is the one that costs real code. |
| `db.pragma(str, { simple: true })` helper | `db.exec()` / `db.prepare().get()`, plus `enableForeignKeyConstraints` and `timeout` constructor options | Cosmetic. §6's three pragmas are all reachable. |
| `db.backup()` (online backup) | `sqlite.backup()` exists (async) | Not used in v1. §16 defers export; the schema is export-ready via plain `SELECT`. |
| `db.serialize()` / `deserialize()` | v22: not present (added in Node v26.1.0) | Not used. |
| `stmt.pluck()` / `.expand()` / `.raw()` | `setReturnArrays()` covers `.raw()`; no `pluck`/`expand` | Not used. Repositories map rows explicitly anyway. |
| `db.function()` / `db.aggregate()` / `db.table()` (virtual tables) | `function()` and `aggregate()` present; **no virtual tables** | Not used. §6–§11 are plain SQL. |
| Newer bundled SQLite (3.53.4 vs 3.50.4) | — | Not needed. Both are a decade past the 3.9.0 the exotic indexes require. |
| Mature, stable, semver-versioned API | Stability 1.1 "Active development" on Node 22 | Judgement call — see below. |

Nothing in §6–§11 needs a capability `node:sqlite` lacks outright. The only material loss is `db.transaction()`.

---

## The trade-off, stated plainly

**`node:sqlite`** buys a genuinely smaller surface: no dependency, no `postinstall`, no prebuilds, no `.node`
files, no toolchain, ~17 MB smaller installer. It costs an API that Node itself labels *"Active development"*
on the Node major Electron 39 is pinned to for its entire life, an `ExperimentalWarning` on stderr every run,
and a hand-written transaction helper guarding the invariants BUILD_PLAN cares most about.

**`better-sqlite3`** costs a dependency, ~17 MB of unused prebuilds, and a `.node` file that must be unpacked
from the asar (automatic). It buys a stable, well-documented, widely-used API and — specifically —
`db.transaction()` with automatic savepoint nesting, which is the exact primitive §5.1 and §14 lean on.

The decision turns on how much of §13's risk is real, and the measurements say: **almost none of it, as long as
you stay on v13 and delete the `postinstall`.** Swapping the data layer onto an experimental API to avoid a risk
that a one-line deletion already removes is a poor trade. The remaining argument for `node:sqlite` is
minimalism, and minimalism does not outweigh "the API may change under us" for the module every invariant in
this app is enforced by.

### Recommended changes to BUILD_PLAN

1. **§3** — keep `better-sqlite3`; add "v13+ required (Node-API, prebuilt, no rebuild)".
2. **§13** — **remove** `"postinstall": "electron-builder install-app-deps"`. It is not merely unnecessary; it
   fails on any machine without a C++ toolchain, which is the exact dev-machine breakage §13 set out to prevent.
   Replace the paragraph about ABI rebuilds with: *`better-sqlite3` v13 is a Node-API addon shipping prebuilt
   binaries; it needs no rebuild for Electron. Verify the unpacked `.node` is present in a packaged build.*
3. **§13** — `asarUnpack: ["**/*.node"]` can stay (harmless, explicit) but is redundant with `smartUnpack`.
4. **§13** — consider a `files` exclusion for the non-target platform prebuilds to reclaim ~15 MB:
   `!node_modules/better-sqlite3/prebuilds/${/* non-target platforms */}`.
5. **§14** — the instruction "Wrap any multi-statement mutation in a `better-sqlite3` transaction" stands
   unchanged.

### Revisit this if

- `better-sqlite3` stops shipping in-tarball prebuilds, or drops a platform ChronoShift targets.
- Electron moves to a Node major where `node:sqlite` is Stability 2 (Stable). The RC promotion landed in
  Node 25.7.0, so this is plausibly one or two Electron majors out.

---

## Not verified

Stated plainly, because this decision gates the database phase:

1. **macOS and Linux were not tested.** Every runtime result here is Windows 11 x64. The `better-sqlite3`
   prebuild set does include `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `linuxmusl-*`, but
   loading them on those platforms was not exercised.
2. **The packaged `.exe` was not observed running to completion.** `electron-builder --dir` produced a build and
   the resulting `app.asar` + `app.asar.unpacked` layout loaded `better-sqlite3` correctly when launched via the
   Electron binary. Launching `dist/win-unpacked/etest.exe` directly exited 0 without executing the entry point
   — most likely a quirk of the throwaway probe harness (asar integrity, or the probe's own `require('electron')`
   resolution), not a `better-sqlite3` problem, but it was not chased down. **Before committing to this, run
   §13's own check: build a package and confirm the app opens the database.**
3. **Whether `@electron/rebuild` will learn to skip Node-API modules that omit `napi_versions`**, or whether
   `better-sqlite3` will add that field. Either would make `install-app-deps` harmless again. Neither is
   documented as planned.
4. **Which Node version Electron 40+ will ship**, and therefore when `node:sqlite` reaches Stability 2 inside
   Electron. Unreleased; not knowable from primary sources today.
5. **Long-term `node:sqlite` API churn.** "Active development" is a statement of intent, not a changelog. No
   attempt was made to predict which specific APIs might change.

## Sources

Primary sources only; no blog posts were used.

- [Node.js `node:sqlite` docs (current)](https://nodejs.org/api/sqlite.html)
- [Node.js `node:sqlite` docs (v22 LTS)](https://nodejs.org/docs/latest-v22.x/api/sqlite.html)
- [Node.js Node-API docs (ABI stability, version matrix)](https://nodejs.org/api/n-api.html)
- [nodejs/node v22.21.1 `node.gni`](https://github.com/nodejs/node/blob/v22.21.1/node.gni) and [`deps/sqlite/sqlite3.h`](https://github.com/nodejs/node/blob/v22.21.1/deps/sqlite/sqlite3.h)
- [Electron release metadata for v39.2.6](https://releases.electronjs.org/release/v39.2.6) and [releases.json](https://releases.electronjs.org/releases.json)
- [electron/electron#45532 — Enable node:sqlite in Electron](https://github.com/electron/electron/issues/45532)
- [better-sqlite3 README](https://github.com/WiseLibs/better-sqlite3/blob/master/README.md), [API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md), [troubleshooting](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md), and the published `better-sqlite3@13.0.3` npm tarball (`binding.gyp`, `package.json`, `prebuilds/`)
- [electron-builder — Application Contents / smartUnpack](https://www.electron.build/docs/contents/) and [Build Lifecycle](https://www.electron.build/docs/features/build-lifecycle/)
- [SQLite — Partial Indexes](https://www.sqlite.org/partialindex.html) and [Indexes On Expressions](https://www.sqlite.org/expridx.html)
- Local execution: Electron 39.2.6 (Node 22.21.1, SQLite 3.50.4) main process, Windows 11 x64; local Node v24.0.2 (SQLite 3.49.1) for comparison only.
