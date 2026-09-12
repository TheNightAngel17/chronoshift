# Build Plan — ChronoShift

A background desktop app with a system tray icon that tracks which "bucket" of work you're on, prompts periodically to confirm, and lets you review and correct your week.

This document is the specification of record. Build to it. Where it is silent, prefer the simplest thing that satisfies the stated invariants, and leave a `// TODO(spec):` comment rather than inventing a behavior that contradicts something here.

**Where things live.** `CONTEXT.md` at the repo root is the glossary — what the words mean. This document is what to build. `docs/adr/` is why a contested choice went the way it did.

**Keeping this honest.** When reality and this document disagree on a structural fact — a path, a version, a name — fix this document; it is not a historical record. When a genuine trade-off is settled, write an ADR and leave a one-line pointer here.

---

## 1. Goals

- Runs in the background with a **system tray icon**, no admin rights required to install or run.
- Tray menu drives tracking: start, switch bucket, take a break, stop, open main window.
- Periodic **check-in prompt**: "Still working on X?" → confirm, switch, or stop, each with an optional "since when" backdate.
- **OS idle detection**: when you come back from being away, the app asks what that gap was.
- A **main window** with two tabs: Review and Configuration.
- Review shows a **week grid** — days as columns, time running vertically — plus a table view and rollup totals.
- Time you haven't explicitly confirmed is stored and displayed as **presumed**, not silently treated as fact.
- Windows is the primary target. The codebase stays portable and the macOS/Linux builder targets stay configured, but neither is built nor verified for v1 — see §12 Phase 9.

## 2. Non-goals for v1

Do not build these. Do not add dependencies or schema in anticipation of them beyond what section 6 specifies.

- CSV or any other export (deliberately deferred; the schema is export-ready)
- Workday (or any external system) sync — schema has provenance columns, no sync code
- Multi-user, cloud sync, accounts, or any network calls whatsoever
- Automatic activity detection (window titles, app usage, git activity)
- Reporting beyond the week grid, table, and rollup totals
- Invoicing, billing rates, or rounding rules
- Mobile or web deployment

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Electron** | Tray API, per-user install, cross-platform |
| Language | **TypeScript**, `strict: true` | Everywhere — main, preload, renderer, shared |
| Build | **electron-vite** | Handles main/preload/renderer bundling and HMR |
| UI | **React 19** + plain CSS Modules | No component library, no Tailwind |
| Database | **better-sqlite3** | Synchronous, main process only |
| Packaging | **electron-builder** | Per-user NSIS on Windows |
| Dates | **date-fns** | No moment, no dayjs, no luxon |
| State | React Context + hooks | No Redux/Zustand/Jotai unless it becomes genuinely necessary |

**Do not substitute** any of the above without a comment explaining why.

> **`better-sqlite3` was challenged and stands** — see issue [#4](https://github.com/TheNightAngel17/chronoshift/issues/4). `node:sqlite` was evaluated against every §6 requirement from inside the Electron 39.2.6 main process and clears all of them: the three pragmas, both exotic indexes (created *and* enforced), transactions and savepoints. It loses on maturity and ergonomics, not capability. On Electron 39 it is Stability 1.1 "Active development" — the whole 39.x major is pinned to Node 22, and the RC promotion landed in Node 25.7 — and it has no equivalent of `db.transaction(fn)` with automatic savepoint nesting, which is the exact primitive §14 requires for every multi-statement mutation and on which §5.1's invariants depend. Revisit only when Electron ships a Node where `node:sqlite` reaches Stability 2.

## 4. Project structure

```
/
├── README.md
├── CLAUDE.md
├── CONTEXT.md                       # glossary only — what the words mean
├── docs/
│   ├── BUILD_PLAN.md                # this document — what to build
│   ├── adr/                         # why a contested choice went the way it did
│   └── agents/                      # how agent skills consume this repo
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── .github/
│   └── workflows/
│       ├── ci.yml                   # lint + test + build, gated on app/ changes
│       └── release.yml              # tag push -> Windows installer + GitHub Release
└── app/                             # the Electron app; every path below is app-relative
    ├── package.json
    ├── electron.vite.config.ts
    ├── electron-builder.yml
    ├── eslint.config.mjs            # flat config, not .eslintrc.cjs
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── tsconfig.web.json
    ├── build/                       # electron-builder scaffold icons — see §13
    ├── resources/
    │   ├── tray-icon.png            # 16/32px, template-style for macOS
    │   ├── tray-icon.ico            # Windows
    │   ├── icon.png                 # imported by main via ?asset
    │   └── app-icon.png
    └── src/
        ├── shared/                  # imported by BOTH main and renderer — no Node or DOM APIs
        │   ├── types.ts             # Bucket, Segment, TrackingState, Settings, etc.
        │   ├── ipc-contract.ts      # channel names + request/response types
        │   ├── time.ts              # pure time helpers (epoch math, day boundaries)
        │   ├── tabs.ts              # main window tab definitions          [exists]
        │   └── startup.ts           # --hidden launch flag parsing         [exists]
        ├── preload/
        │   └── index.ts             # contextBridge surface only           [exists]
        ├── main/
        │   ├── index.ts             # lifecycle, single-instance lock, wiring  [exists]
        │   ├── db/
        │   │   ├── connection.ts
        │   │   ├── migrations/
        │   │   │   ├── index.ts     # forward-only runner
        │   │   │   └── 001_initial.ts
        │   │   └── repositories/
        │   │       ├── buckets.ts
        │   │       ├── segments.ts
        │   │       ├── settings.ts
        │   │       ├── checkins.ts
        │   │       ├── idleEvents.ts
        │   │       └── appState.ts
        │   ├── services/
        │   │   ├── tracking.ts      # the state machine — see section 5
        │   │   ├── scheduler.ts     # check-in timer
        │   │   ├── idleMonitor.ts   # powerMonitor polling + lock/suspend events
        │   │   ├── heartbeat.ts     # writes last_seen_at
        │   │   ├── recovery.ts      # startup reconciliation
        │   │   └── autostart.ts     # login item management
        │   ├── windows/
        │   │   ├── mainWindow.ts
        │   │   └── promptWindow.ts
        │   ├── tray/
        │   │   ├── index.ts                                                [exists]
        │   │   └── menu.ts          # rebuilt on every state change         [exists]
        │   └── ipc/
        │       ├── index.ts
        │       └── handlers/*.ts
        └── renderer/
            ├── index.html           # main window entry                    [exists]
            ├── prompt.html          # prompt window entry
            └── src/
                ├── main-app/
                │   ├── App.tsx      # tab shell
                │   └── tabs/
                │       ├── ReviewTab.tsx
                │       └── ConfigTab.tsx
                ├── prompt-app/
                │   ├── App.tsx      # routes on ?kind=checkin|start|idle|recovery
                │   ├── StartPrompt.tsx
                │   ├── CheckinPrompt.tsx
                │   ├── IdlePrompt.tsx
                │   └── RecoveryPrompt.tsx
                ├── components/
                │   ├── WeekGrid/
                │   ├── SegmentTable/
                │   ├── RollupTotals/
                │   ├── BucketPicker/     # prompts — drill-down + typeahead + recents
                │   ├── BucketTreeEditor/ # config
                │   ├── SinceWhenInput/
                │   └── SegmentEditModal/
                ├── hooks/
                └── styles/
```

`[exists]` marks what Phase 1 already built; everything else is still to come. Two Phase-1 scaffold files fall outside this tree and are dealt with when `main-app/` lands: `src/renderer/src/App.tsx` moves to `main-app/App.tsx`, and `src/renderer/src/components/Versions.tsx` is template boilerplate that goes away.

## 5. Domain model and invariants

### 5.1 The timeline

Tracked time is a sequence of **segments**. A segment is a contiguous stretch of time attributed to exactly one bucket.

These invariants must hold at all times. Enforce them in the repository layer inside a single transaction, not in the UI.

1. **At most one open segment.** An open segment has `ended_at IS NULL`. There is never more than one.
2. **No overlaps.** For any two segments, `[started_at, ended_at)` ranges do not intersect. Because of this, the week grid never needs collision or side-by-side layout — a real simplification, rely on it.
3. **Gaps are legal.** Untracked time is simply the absence of a segment. Do not create filler rows for it.
4. **`started_at < ended_at`** for every closed segment. Zero-length segments are invalid — reject or delete them.
5. **`confirmed_through`**, when set, satisfies `started_at <= confirmed_through <= ended_at` (or `<= now` for the open segment).

### 5.2 Confirmation as a watermark

This is the central idea and the thing most likely to be implemented wrong. **Confirmation is not a boolean.**

Each segment carries `confirmed_through`: a timestamp meaning "the user has affirmatively told us they were on this bucket up to this point." Everything from `started_at` to `confirmed_through` is **confirmed**. Everything after it is **presumed** — we believe it based on the last known state, but nobody has verified it.

Worked example:

| Time | Event | Resulting state |
|---|---|---|
| 09:00 | Start tracking "Acme / Build" | Segment A open, `started_at=09:00`, `confirmed_through=09:00` |
| 09:15 | Check-in → "Yes, still on it" | A: `confirmed_through=09:15` |
| 09:30 | Check-in → ignored | A unchanged. 09:15→now renders as presumed |
| 09:45 | Check-in → ignored | A unchanged |
| 10:00 | Check-in → "Switched to Beta / Fix, since 09:40" | A closes: `ended_at=09:40`, `confirmed_through=09:40`. B opens: `started_at=09:40`, `confirmed_through=10:00` |

Note the retroactive confirmation on A: by saying "I switched at 09:40," the user implicitly confirmed A ran until then. Apply that.

Derived states for display:

- **Confirmed** — `confirmed_through >= ended_at` (or `>= now` for open). Render solid.
- **Partially confirmed** — `confirmed_through` falls inside the segment. Render solid up to the watermark, hatched after.
- **Presumed** — `confirmed_through IS NULL` or equals `started_at`. Render fully hatched.

Anything not fully confirmed appears in the **Needs review** queue on the Review tab.

### 5.3 Break / idle

Break is modelled as a **reserved system bucket** (`kind='break'`, `is_system=1`), not as a separate state or a null bucket. This keeps the timeline uniform: one code path for rendering, editing, splitting, and merging.

Rollup totals must exclude `kind='break'` from work totals and report it on its own line.

Seed exactly one system break bucket in migration 001, at depth 0, named "Break / Away". It cannot be renamed, archived, moved, or deleted.

### 5.4 Buckets

A nested tree, **maximum 4 levels** (`depth` 0–3).

- **Any node is trackable**, including nodes with children. "Acme, general" is a legitimate thing to book time to.
- `parent_id` is a self-referential FK. Reject any insert or move that would exceed depth 3 or create a cycle.
- **Colors**: `color` is nullable. When null, inherit from the nearest ancestor with a color set; if none, fall back to a deterministic color derived from `id` so the grid is never colorless.
- **Archiving, not deleting**: `is_archived` hides a bucket from pickers but preserves history. Only allow hard delete when no segments reference the bucket — the FK is `ON DELETE RESTRICT`, so let it throw and surface a clear message.
- **Provenance columns** (`source`, `external_id`, `external_type`) exist for a future Workday sync. Populate `source='local'` and leave the rest null. Write no sync code.
- **Recents** are derived, not stored: query the most recent distinct `bucket_id` values from `segments`.

### 5.5 Time representation

- Store **every** timestamp as an **integer, UTC epoch milliseconds**. Never a string, never a local-time value, never a SQLite date function.
- Convert to local time only at the rendering boundary in the renderer.
- Segments that cross midnight are stored as **one segment**. The week grid splits them visually at the day boundary; the data does not.
- Do not attempt DST correction arithmetic. Epoch ms plus `date-fns` local formatting handles it.

### 5.6 "Since when" backdating

Every prompt that changes state offers an optional backdate. The `SinceWhenInput` component provides:

- Quick relative buttons: 5, 10, 15, 30 minutes ago
- An absolute time entry field
- Default: now

**Clamping rules** — enforce in the main process, not just the UI:

- Cannot be in the future.
- Cannot be earlier than the current open segment's `started_at`.
- Cannot be earlier than the previous segment's `ended_at`.
- If the value would produce a zero-length segment, snap to now and note it.

## 6. Database schema

SQLite at `path.join(app.getPath('userData'), 'timetracker.db')`.

Enable on every connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Migrations are **forward-only**, numbered, and run inside a transaction. Track the applied version in `schema_meta`. Never edit a shipped migration; add a new one.

```sql
CREATE TABLE schema_meta (
  version    INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE buckets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id     INTEGER REFERENCES buckets(id) ON DELETE RESTRICT,
  name          TEXT    NOT NULL,
  depth         INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 3),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  color         TEXT,
  kind          TEXT    NOT NULL DEFAULT 'work' CHECK (kind IN ('work','break')),
  is_system     INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  is_archived   INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  source        TEXT    NOT NULL DEFAULT 'local' CHECK (source IN ('local','workday')),
  external_id   TEXT,
  external_type TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_buckets_parent ON buckets(parent_id);
CREATE UNIQUE INDEX idx_buckets_sibling_name
  ON buckets(COALESCE(parent_id, -1), name) WHERE is_archived = 0;

CREATE TABLE segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_id         INTEGER NOT NULL REFERENCES buckets(id) ON DELETE RESTRICT,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  confirmed_through INTEGER,
  origin            TEXT    NOT NULL CHECK (origin IN
                      ('manual','checkin','idle_resolution','recovery','edit','split')),
  note              TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at > started_at)
);
CREATE INDEX idx_segments_started ON segments(started_at);
CREATE INDEX idx_segments_bucket  ON segments(bucket_id);
-- Defence-in-depth for "at most one open segment".
-- Authoritative enforcement is still the transaction in segments repository.
--
-- The CASE expression is LOAD-BEARING. Do not "simplify" it to
--   ON segments(ended_at) WHERE ended_at IS NULL
-- which is a silent no-op: NULLs are always distinct in a unique index,
-- so that form happily accepts a second open segment. Verified in #5.
CREATE UNIQUE INDEX idx_segments_single_open
  ON segments((CASE WHEN ended_at IS NULL THEN 1 END))
  WHERE ended_at IS NULL;

CREATE TABLE checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id   INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  prompted_at  INTEGER NOT NULL,
  responded_at INTEGER,
  response     TEXT CHECK (response IN
                 ('same','switched','stopped','break','snoozed','dismissed','timeout')),
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_checkins_prompted ON checkins(prompted_at);

CREATE TABLE idle_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  cause       TEXT NOT NULL CHECK (cause IN ('inactivity','lock','suspend','app_gone')),
  resolution  TEXT CHECK (resolution IN ('kept','break','reassigned','split','unresolved')),
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_idle_started ON idle_events(started_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,   -- JSON-encoded
  updated_at INTEGER NOT NULL
);

CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Keys in use: 'last_seen_at', 'last_bucket_id', 'clean_shutdown'
```

### 6.1 Constraint naming and error mapping

Both indexes above were verified empirically against SQLite 3.49.1 and cross-checked on 3.22.0 (issue [#5](https://github.com/TheNightAngel17/chronoshift/issues/5)). Both enforce exactly what they claim, on insert and on update. Four consequences bind the repository layer:

1. **Name every CHECK constraint.** Write `CONSTRAINT segment_ends_after_start CHECK (...)` rather than a bare `CHECK (...)`. An unnamed CHECK produces error text that *changes between SQLite versions* — 3.22.0 reports the table name, 3.49.1 reports the expression source — so any message-matching code is a time bomb. A named constraint reports its own name on both. **This must land in `001_initial`**: migrations are forward-only, and §6 says never edit a shipped one.
2. **Map errors on the numeric code plus the constraint name**, never on the driver's error class. Constraint violations arrive as SQLite result code `2067` for `UNIQUE`, `275` for `CHECK`, and `1811` for a foreign key, with the offending index or constraint name in the message text. Some drivers flatten every one of these to a single generic code and message, so the code alone does not identify what failed.
3. **`FOREIGN KEY constraint failed` identifies nothing** — not the table, not the column, not the row. §5.4 requires a clear message when a bucket cannot be deleted because segments reference it; that message has to be built by querying for the dependants first, not by parsing the error.
4. **Uniqueness is checked per statement, not deferred to `COMMIT`.** Inside the switch transaction, the outgoing segment must be closed *before* the incoming one is opened, or `idx_segments_single_open` rejects the second insert mid-transaction. The same applies to swapping two sibling bucket names, which cannot be done in a single `UPDATE`.

Also note the sibling-name index is case- and whitespace-sensitive: `Zed`, `zed` and `Zed ` are three distinct buckets. Decide at the repository boundary whether to normalise names on the way in.

Settings are stored **only** here. Do not add `electron-store`, and do not use `localStorage` or `sessionStorage` anywhere in the renderer.

## 7. Settings and defaults

Seed these in migration 001. The Configuration tab edits them.

| Key | Default | Meaning |
|---|---|---|
| `checkin_interval_minutes` | `15` | Time between check-in prompts |
| `idle_threshold_minutes` | `5` | Inactivity before an idle event opens |
| `snooze_minutes` | `5` | Snooze duration on a check-in |
| `auto_stop_after_hours` | `12` | Safety net: warn and offer to stop after this long |
| `week_start_day` | `1` | 0 = Sunday … 6 = Saturday |
| `grid_start_hour` | `6` | Top of the week grid |
| `grid_end_hour` | `20` | Bottom of the week grid |
| `grid_snap_minutes` | `5` | Drag snap increment |
| `prompt_steal_focus` | `true` | Prompt window takes focus on open |
| `prompt_sound` | `false` | Play a sound with prompts |
| `autostart_enabled` | `true` | Launch at login |
| `autostart_begin_tracking` | `false` | Auto-resume last bucket at launch |
| `theme` | `"system"` | `system` / `light` / `dark` |

Note that check-ins fire whenever tracking is running, with **no work-hours restriction**. `auto_stop_after_hours` is the guard against a forgotten overnight session — when it trips, prompt with a strong suggestion to close the segment at the last confirmed point.

## 8. Main process behavior

### 8.1 Lifecycle

- Acquire a **single-instance lock**. If a second instance launches, focus the existing main window and exit.
- Closing the main window **hides it** — it does not quit the app. Quit only from the tray menu's Quit item or `app.quit()`.
- On quit, close the open segment's clock cleanly: write `last_seen_at` and set `clean_shutdown = true`. Do **not** auto-close the segment — a running segment should survive a restart.
- On macOS, do not quit on `window-all-closed`. On Windows and Linux, same — this is a tray app.

### 8.2 Tray

- Icon reflects state: idle (not tracking), tracking, on break. Three distinct icons or one icon with an overlay.
- Tooltip shows current bucket and elapsed time, refreshed at most once a minute.
- Menu, rebuilt on every tracking state change:

**Not tracking:**
```
Start tracking…            → opens StartPrompt
Recent: <bucket 1>         → starts immediately, no prompt
Recent: <bucket 2>
─────────
Open ChronoShift
Settings…                  → main window, Config tab
─────────
Quit
```

**Tracking:**
```
▸ Acme / Build — 1h 24m    (disabled, informational)
Confirm still on this      → sets confirmed_through = now
Switch bucket…             → opens CheckinPrompt in switch mode
Take a break               → switches to the system break bucket
Stop tracking…             → opens CheckinPrompt in stop mode
─────────
Open ChronoShift
Settings…
─────────
Quit
```

### 8.3 Scheduler

- When a segment opens, schedule the next check-in at `now + checkin_interval_minutes`.
- Confirming, switching, or snoozing **reschedules** from that moment.
- Ignoring a prompt does **not** reschedule aggressively — schedule the next one one interval later, and record `response='timeout'` on the previous `checkins` row when it's superseded. The goal is to be persistent without becoming a machine gun.
- Never fire a check-in while no segment is open.
- Never fire a check-in while an idle event is unresolved.
- Use a self-correcting timer: compute the delay from a target timestamp each tick rather than trusting `setInterval` drift, and re-evaluate on `resume`.

### 8.4 Idle monitor

Sources of an idle event:

- `powerMonitor.getSystemIdleTime()` polled every 15s exceeding `idle_threshold_minutes` → cause `inactivity`
- `powerMonitor` `lock-screen` → cause `lock`
- `powerMonitor` `suspend` → cause `suspend`

Open an `idle_events` row when idleness begins (backdate `started_at` to when inactivity actually started, which is `now - idleTime`, not when you noticed). Close it on `unlock-screen`, `resume`, or activity returning.

On close, if the gap is at or above `idle_threshold_minutes` **and** a segment was open, show `IdlePrompt`. Do not show it for gaps below the threshold, and do not show it if nothing was being tracked.

Only one idle event may be unresolved at a time. While one is unresolved, suppress check-ins.

### 8.5 Heartbeat and crash recovery

- `heartbeat.ts` writes `app_state.last_seen_at = Date.now()` every 30 seconds.
- On startup, `recovery.ts` runs **before** the tray or any window appears:
  1. Read `clean_shutdown` and `last_seen_at`; then set `clean_shutdown = false`.
  2. If an open segment exists and `now - last_seen_at > 2 * idle_threshold_minutes`, the app died or the machine slept hard. Record an `idle_events` row with cause `app_gone` spanning `last_seen_at → now`, and show `RecoveryPrompt`.
  3. If the open segment's unconfirmed tail is absurd (say beyond `auto_stop_after_hours`), still prompt — but pre-select "end it at the last confirmed point" as the default option.

Without this you get silent sixteen-hour entries, which is the failure mode that makes people abandon time trackers.

## 9. Prompt windows

All prompts render from `prompt.html` in a single `BrowserWindow` class, routed by a `?kind=` query param. Reuse one window instance where possible; never allow two prompts on screen at once — queue them.

Window options: `frame: false`, `resizable: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `show: false` until ready-to-show, roughly 420×340, positioned near the tray / bottom-right of the active display. Respect `prompt_steal_focus` for whether to call `focus()`.

Escape closes a prompt as `dismissed`. A prompt left open when the next check-in is due is superseded and recorded as `timeout`.

### 9.1 StartPrompt

"What are you working on?" → `BucketPicker` + `SinceWhenInput` + Start / Cancel.

### 9.2 CheckinPrompt

Headline: "Still working on **Acme / Build**?" with elapsed time and, when relevant, "unconfirmed since 09:15."

Actions:
- **Yes, still on it** → `confirmed_through = now`
- **Switch to…** → reveals `BucketPicker` + `SinceWhenInput`
- **Take a break** → switch to the break bucket, with `SinceWhenInput`
- **Stop tracking** → reveals `SinceWhenInput`
- **Snooze** → reschedule by `snooze_minutes`, record `snoozed`

### 9.3 IdlePrompt

"You were away from 10:15 to 10:37 — 22 minutes. What was that?"

Actions:
- **Keep it on Acme / Build** → confirm across the gap
- **That was a break** → split: close the segment at gap start, insert a break segment for the gap, reopen the original bucket at gap end
- **It was something else…** → `BucketPicker`, same three-way split with the chosen bucket
- **Leave it untracked** → close the segment at gap start, open a new one for the same bucket at gap end, gap stays empty

Whichever is chosen, write `idle_events.resolution` and `resolved_at`.

### 9.4 RecoveryPrompt

"ChronoShift was last running at 4:52pm yesterday, tracking Acme / Build. That segment is still open." Show last-confirmed time. Actions: end at last confirmed point (default), end at last-seen, end at a time I'll enter, or keep it running.

## 10. Renderer — main window

Two top-level tabs. Tab state persists across window hide/show within a session.

### 10.1 Review tab

**Week grid** — the primary view.

- Seven day columns (or the configured week start's week), time vertical from `grid_start_hour` to `grid_end_hour`.
- Hour gridlines with labels down the left gutter; a subtler line at each half hour.
- Segments render as colored blocks positioned and sized by time, using the bucket's effective color.
- **Confirmed portions solid; presumed portions hatched** (a 45° repeating-linear-gradient stripe reads well). A partially confirmed segment is solid up to `confirmed_through` and hatched after — one block, two fills.
- Break segments use a muted neutral fill regardless of bucket color.
- A "now" line on today's column.
- Segments extending outside the visible hour range get a clipped indicator at the column edge rather than being hidden — otherwise time silently disappears.
- Midnight-crossing segments render as two blocks, one per day, visually joined; they remain a single row in the database.
- Because segments never overlap, no collision layout is required.

Week navigation: previous / next / today, plus a date jump. Show the week's total and per-day totals in the column headers.

**Editing**, both paths against the same IPC handlers:

- *Drag* — move a block to change its start while preserving duration; drag its top or bottom edge to resize; snap to `grid_snap_minutes`. Dragging must not be allowed to create an overlap: clamp against neighbors, and show the clamp visually rather than silently refusing.
- *Modal* — click a block to open `SegmentEditModal` with exact start/end fields, bucket reassignment, note, `confirmed_through` control, and Split / Merge / Delete.

**Split** at time `T` (`started_at < T < ended_at`): produce two segments. First gets `ended_at = T` and `confirmed_through = min(original, T)`. Second gets `started_at = T` and `confirmed_through = original > T ? original : null`. Both get `origin='split'`.

**Merge**: only permitted for two segments that are adjacent (`a.ended_at === b.started_at`) and share a `bucket_id`. Result spans both, `confirmed_through = max(a, b)`, `origin='edit'`.

**Table view** — a toggle beside the grid, same week's data: start, end, duration, bucket path, confirmation state, note, origin. Sortable, with the same edit affordances. This is the fast path for bulk correction.

**Rollup totals** — for the visible week: total hours per bucket, grouped by tree ancestry so parent rows subtotal their children; confirmed vs presumed split per row; break time on its own line, excluded from work totals.

**Needs review** — a compact list of every segment in the visible week where confirmation is incomplete, each with a one-click "confirm as-is" and a jump-to-block. Give this a visible count badge; it's the mechanism that keeps the data honest.

### 10.2 Configuration tab

- **Bucket tree editor** — add, rename, reorder (`sort_order`), reparent, set color, archive, delete-if-unused. Show depth limits by disabling "add child" at depth 3. Never permit editing the system break bucket beyond its color.
- **Settings form** — every key from section 7, grouped as Tracking, Prompts, Appearance, Startup. Validate ranges, write on change, apply immediately (interval changes reschedule the pending check-in).
- **Data** — show the database path with a "reveal in file manager" button. A "danger zone" with delete-all-data behind a typed confirmation.

### 10.3 BucketPicker

Used in every prompt, so it deserves care — it's the component touched twenty times a day.

- Opens on the **recents** list (last ~8 distinct buckets used) plus a search field, focused.
- Typing filters across the **flattened** tree, matching on the full path and displaying it as `Acme / Website / Build / Testing`. Substring match on any segment of the path.
- Not typing, you can **drill down**: folder rows show a chevron and push a level, with a breadcrumb and back affordance.
- Any node is selectable, folders included — a row's label selects it while its chevron drills in. Keep those hit targets clearly distinct.
- Fully keyboard operable: arrows, Enter to select, Backspace to go up a level, Escape to close.
- Archived buckets excluded.

## 11. IPC contract

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where possible. The preload exposes one namespaced object via `contextBridge`. No `ipcRenderer` in renderer code, no remote module, no direct database access from the renderer — ever.

Define channel names and payload types once in `src/shared/ipc-contract.ts` and import them on both sides so a rename breaks the build rather than failing at runtime.

**Invoke (renderer → main):**

```
buckets:tree            → BucketNode[]
buckets:create          (parentId, name, color?)      → Bucket
buckets:update          (id, patch)                   → Bucket
buckets:move            (id, newParentId, sortOrder)  → void
buckets:archive         (id, archived)                → void
buckets:delete          (id)                          → void   // throws if referenced
buckets:recents         (limit)                       → Bucket[]

tracking:state          → TrackingState
tracking:start          (bucketId, since?)            → TrackingState
tracking:switch         (bucketId, since?)            → TrackingState
tracking:stop           (since?)                      → TrackingState
tracking:confirm        (at?)                         → TrackingState
tracking:snooze         (minutes?)                    → void

segments:range          (fromMs, toMs)                → Segment[]
segments:create         (bucketId, start, end, note?) → Segment
segments:update         (id, patch)                   → Segment
segments:split          (id, atMs)                    → [Segment, Segment]
segments:merge          (idA, idB)                    → Segment
segments:delete         (id)                          → void
segments:needsReview    (fromMs, toMs)                → Segment[]

settings:getAll         → Settings
settings:set            (key, value)                  → Settings

idle:pending            → IdleEvent | null
idle:resolve            (id, resolution, payload)     → void
recovery:pending        → RecoveryInfo | null
recovery:resolve        (choice, payload)             → void

app:openMainWindow      (tab?)                        → void
app:revealDatabase      → void
```

**Events (main → renderer):**

```
tracking:changed   → TrackingState      // tray, prompts, and grid all react
segments:changed   → { fromMs, toMs }   // invalidate and refetch the visible range
settings:changed   → Settings
prompt:show        → PromptPayload
```

Every invoke handler validates its arguments and returns a discriminated result rather than throwing across the boundary:

```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

## 12. Build phases

Complete each phase to its acceptance criteria before starting the next. Each phase should end at a commit where the app runs.

**Phase 1 — Skeleton**
electron-vite + TypeScript + React scaffold. Main window with two empty tabs. Tray icon with a menu that opens the window and quits. Single-instance lock. Close-to-tray.
*Accepts when:* `npm run dev` launches, tray works, closing the window hides it, only one instance runs.

**Phase 2 — Database**
`better-sqlite3` wired up with the native rebuild working. Migration runner plus `001_initial`. All repositories with typed methods. Seed the break bucket and default settings.
*Accepts when:* the app creates its database in `userData` on first run, migrations are idempotent across restarts, and repository methods are exercised by a scratch script.

**Phase 3 — Buckets**
IPC for buckets. Configuration tab's tree editor: create, rename, reparent, reorder, color, archive. Depth and cycle validation.
*Accepts when:* a four-level tree can be built and rearranged in the UI, depth 4 is refused, and the system break bucket resists editing.

**Phase 4 — Tracking core**
`tracking.ts` state machine, segment invariants in transactions, tray menu reflecting state, `StartPrompt`, manual start/switch/stop with `SinceWhenInput` and full clamping.
*Accepts when:* you can start, switch, and stop from the tray; the database shows a clean non-overlapping timeline; backdating works and refuses invalid values; only one segment is ever open.

**Phase 5 — Check-ins**
Scheduler, `CheckinPrompt`, all five actions, `confirmed_through` watermark maintenance including retroactive confirmation on switch, `checkins` logging, snooze, `auto_stop_after_hours` guard.
*Accepts when:* prompts arrive on the configured interval, each action produces the right watermark, ignored prompts leave presumed time rather than gaps, and interval changes take effect without a restart.

**Phase 6 — Idle and recovery**
Heartbeat, idle monitor across all three causes, `IdlePrompt` with its four resolutions, startup `recovery.ts` and `RecoveryPrompt`.
*Accepts when:* locking the screen for longer than the threshold produces a prompt on return; each resolution produces correct segments; killing the app mid-segment produces a recovery prompt on relaunch with sane defaults.

**Phase 7 — Review**
Week grid with confirmed/presumed rendering, week navigation, table view, rollup totals, needs-review list, `SegmentEditModal` with split/merge/delete/reassign.
*Accepts when:* a week of real tracked time renders correctly, presumed time is visually distinct, totals reconcile against the raw segments, and every edit operation round-trips through the database and re-renders.

**Phase 8 — Drag editing and polish**
Drag-move and drag-resize with snapping and overlap clamping. Autostart. Theme. Empty states. Keyboard navigation. Icon states.
*Accepts when:* dragging cannot produce an overlap or an inverted segment, autostart survives a reboot, and the app is pleasant enough to actually use for a week.

**Phase 9 — Packaging**
`electron-builder` producing a per-user Windows installer that needs no admin rights. Verify the database layer ships correctly in a packaged build.
*Accepts when:* the installer completes as a standard user without elevating, the app launches from the Start menu, and the database in `userData` survives an upgrade install.

macOS and Linux are deliberately **not** part of this acceptance. The targets stay configured and the code stays portable, but an unverified build target is a false assurance, so v1 does not claim one.

## 13. Packaging

`electron-builder.yml`:

```yaml
appId: com.mitchell.chronoshift
productName: ChronoShift
directories:
  output: dist
  buildResources: resources
files:
  - out/**/*
  - package.json
asarUnpack:
  - '**/*.node'
win:
  target:
    - nsis
    - portable
  icon: resources/tray-icon.ico
  executableName: chronoshift
nsis:
  oneClick: false
  perMachine: false                       # per-user install, no admin rights
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
mac:
  target: dmg
  category: public.app-category.productivity
linux:
  target:
    - AppImage
  category: Utility
npmRebuild: false
```

`perMachine: false` is the requirement that keeps this installable without admin rights — it lands in `%LOCALAPPDATA%\Programs`. The `portable` target is a useful fallback for locked-down machines.

**Native modules — the ABI risk is obsolete, and the mitigation is the bug.** `better-sqlite3` v13 is a Node-API addon that ships prebuilt binaries inside its npm tarball. It installs with no compiler present and loads in Electron 39 with no rebuild — verified in [#4](https://github.com/TheNightAngel17/chronoshift/issues/4) from inside the Electron 39.2.6 main process. The delivery model changed at v13; older advice about rebuilding against the Electron ABI, including the paragraph that used to sit here, predates it. **`npmRebuild: false` above is therefore correct, not an oversight.**

> ⚠️ **The `postinstall` running `electron-builder install-app-deps` is actively broken and should be deleted.** v13 omits a `napi_versions` field, so `@electron/rebuild` fails to recognise it as Node-API, forces a source build anyway, and dies with `Could not find any Visual Studio installation to use` on any machine without build tools. It is trying to rebuild a binary that already works. Removing it is a one-line change and belongs in the Phase 2 database work.

> **`asarUnpack` is redundant but expensive.** electron-builder's `smartUnpack` already unpacks `.node` files without being told. It also unpacks *every* platform's prebuild: roughly 17 MB shipped where only ~1.9 MB is reachable in a Windows x64 build. A `files` exclusion reclaims about 15 MB per installer — worth doing in Phase 9, not before.

Phase 9 must still confirm the **installed** app launches and reaches its database. #4 built the packaged asar layout and confirmed the module loads under the Electron binary, but did not observe the installed executable run end to end — that remains the job of the packaging spike, [#6](https://github.com/TheNightAngel17/chronoshift/issues/6).

**The installer is unsigned, deliberately.** No code-signing certificate is bought for v1. Expect Windows SmartScreen to warn on install (“Windows protected your PC” → More info → Run anyway), and expect some Defender configurations to be noisier still. This is accepted: the app is for personal use and the cost is one extra click. It is written down here so it is not a surprise on the last step of the last phase.

**Icons need a second look.** `win.icon` points at `resources/tray-icon.ico`, but a tray icon is 16/32px while an installer and Start-menu entry want up to 256px — `resources/app-icon.png` exists for this and is currently unused. Separately, `app/build/` still holds the electron-vite scaffold’s icons while `directories.buildResources` points at `resources/`, so one of those two directories is dead weight. Neither blocks anything before Phase 9.

Autostart via `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`, and honor `--hidden` by not showing the main window on launch.

## 14. Instructions for the implementer

These apply to every lane — a developer at the keyboard, a Claude Code session, or an autonomous Copilot run. Read them before generating code, and re-read them when touching anything time- or database-related.

**Always:**
- Use TypeScript with `strict: true`. No `any` — use `unknown` and narrow.
- Store timestamps as integer UTC epoch milliseconds. Convert to local only when rendering.
- Keep all database access in the main process, behind a repository module.
- Wrap any multi-statement mutation in a `better-sqlite3` transaction.
- Import channel names and payload types from `src/shared/ipc-contract.ts` on both sides.
- Enforce the section 5.1 invariants in the repository, and assume the UI will try to violate them.
- Handle the empty state of every view — no buckets, no segments, first launch.

**Never:**
- Use `localStorage`, `sessionStorage`, or any browser storage. Settings live in SQLite.
- Enable `nodeIntegration`, disable `contextIsolation`, or use `@electron/remote`.
- Add a state management library, component library, CSS framework, or ORM.
- Add a second date library. `date-fns` only.
- Create filler segments for untracked time.
- Model break as a null `bucket_id`. It is a system bucket.
- Treat `confirmed_through` as a boolean, or drop partial confirmation.
- Make network requests. This app is entirely local.
- Edit a migration that has already shipped.

**When uncertain**, prefer the simpler implementation and leave `// TODO(spec): <question>`. Do not invent behavior that contradicts this document; flag the conflict instead.

## 15. Testing notes

Unit tests are worth writing for exactly three things, because they're where the bugs hide:

1. **Segment invariants** — a property-style test that applies a long random sequence of start/switch/stop/split/merge/edit operations and asserts after each that there are no overlaps, at most one open segment, no zero-length segments, and every `confirmed_through` in range.
2. **Watermark arithmetic** — the section 5.2 worked example plus the split and merge rules, as explicit cases.
3. **Clamping** — every "since when" rule from section 5.6, including the awkward ones.

Everything else is better verified by using the app. Use `vitest`; skip renderer component tests for v1.

## 16. Deferred, with hooks already in place

- **Workday sync** — `buckets.source`, `external_id`, `external_type` exist and are unused. A sync would upsert Project → Phase → Task nodes with `source='workday'`, leaving local buckets untouched, and mark synced nodes read-only in the tree editor.
- **Export** — the schema is export-ready. A CSV writer over `segments:range` with optional rounding is a small addition.
- **Global hotkey** for quick switch.
- **Automatic activity hints** to pre-select a likely bucket.
