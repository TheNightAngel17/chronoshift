# Verifying the section 6 partial/expression indexes

Research note for issue [#5](https://github.com/TheNightAngel17/chronoshift/issues/5). Settled **empirically** — the
full BUILD_PLAN section 6 schema was built in a throwaway database and the statements below were actually executed.
Every SQL statement and every result or error string in this document is a literal transcript, not a paraphrase.

## Verdict

| Index | Does it enforce what it claims? |
|---|---|
| `idx_segments_single_open` | **YES.** At most one row with `ended_at IS NULL` is possible. Enforced on `INSERT` and on `UPDATE`, and it refuses to be created over already-violating data. |
| `idx_buckets_sibling_name` | **YES.** Unique `(parent, name)` among non-archived buckets, with `NULL` parents correctly compared equal via the `COALESCE` sentinel. Enforced on insert, on re-parent, and on un-archive. |

`idx_segments_single_open` is **not** a silent no-op. Invariant 5.1.1 has real defence-in-depth at the storage layer.

One caveat that matters more than the verdict: **the obvious "simplification" of that index is a silent no-op**, and a
future reader is likely to attempt it. See [The trap](#the-trap-do-not-simplify-idx_segments_single_open).

## Engine and version tested

| | |
|---|---|
| Primary engine | Node.js `node:sqlite` (`DatabaseSync`), Node **v24.0.2** |
| `SELECT sqlite_version();` | **3.49.1** |
| `SELECT sqlite_source_id();` | `2025-02-18 13:38:58 873d4e274b4988d260ba8354a9718324a1c26187a4ab4c1cc0227c03d0f10e70` |
| Cross-check engine | `sqlite3` CLI, **3.22.0** (2018-12-19) |

**This is not necessarily the SQLite that ships in the app.** `app/package.json` currently pins `electron ^39.2.6` and
declares **no** SQLite binding at all — neither `better-sqlite3` nor a `node:sqlite` usage — and Electron is not
installed in this checkout, so the version Electron ultimately amalgamates could not be measured here. Treat 3.49.1 as
representative, not authoritative. See [Version sensitivity](#version-sensitivity) for what actually varies.

The features in play are old: partial indexes landed in **3.8.0** (2013) and indexes on expressions in **3.9.0** (2015).
Any realistic Electron or `better-sqlite3` build is far past both. The cross-check against 3.22.0 confirms identical
index behaviour 27 minor versions apart.

### Does the binding choice matter?

The issue asks whether `node:sqlite` vs `better-sqlite3` changes anything. **It does not, for these indexes.** Partial
and expression indexes are engine features implemented in the SQLite amalgamation; a binding only marshals the error
out. What *does* differ between bindings is the **shape of the thrown error object**, not the message text — see
[Error strings for the repository layer](#error-strings-for-the-repository-layer). The binding decision is unaffected
by this ticket.

## Experiment 1 — does SQLite accept both statements?

Yes. The entire section 6 DDL executed without a single error: all 6 tables, all 5 plain indexes, and both clever
indexes. Both are stored verbatim and `idx_segments_single_open` is genuinely recorded as partial.

```sql
CREATE UNIQUE INDEX idx_buckets_sibling_name
  ON buckets(COALESCE(parent_id, -1), name) WHERE is_archived = 0;
```

```
OK (no error)
```

```sql
CREATE UNIQUE INDEX idx_segments_single_open
  ON segments((CASE WHEN ended_at IS NULL THEN 1 END))
  WHERE ended_at IS NULL;
```

```
OK (no error)
```

Confirming they were really created rather than silently ignored:

```sql
SELECT name, sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%open';
```

```
OK -> [{"name":"idx_segments_single_open","sql":"CREATE UNIQUE INDEX idx_segments_single_open\n  ON segments((CASE WHEN ended_at IS NULL THEN 1 END))\n  WHERE ended_at IS NULL"}]
```

```sql
SELECT partial FROM pragma_index_list('segments') WHERE name='idx_segments_single_open';
```

```
OK -> [{"partial":1}]
```

## Experiment 2 — two open segments

**The second open segment is rejected.** This is the headline result.

```sql
-- 2a: first OPEN segment
INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (2, 1000, NULL, 1000, 'manual', 1000, 1000);
```

```
OK (no error)
```

```sql
-- 2b: SECOND OPEN segment
INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (1, 2000, NULL, 2000, 'manual', 2000, 2000);
```

```
ERROR name=Error
ERROR message=UNIQUE constraint failed: index 'idx_segments_single_open'
ERROR code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

The table is unchanged — no partial write:

```sql
SELECT id,bucket_id,started_at,ended_at FROM segments;
```

```
OK -> [{"id":1,"bucket_id":2,"started_at":1000,"ended_at":null}]
```

### 2d — the same violation reached by UPDATE

Worth confirming separately, because "re-open a segment" is a real edit path (section 5.4 edits, idle resolution
`kept`). The index covers it:

```sql
-- 2d-i: insert a CLOSED segment
INSERT INTO segments (bucket_id,started_at,ended_at,origin,created_at,updated_at)
     VALUES (2, 100, 200, 'manual', 100, 100);
```

```
OK (no error)
```

```sql
-- 2d-ii: re-open it while another segment is already open
UPDATE segments SET ended_at = NULL WHERE started_at = 100;
```

```
ERROR name=Error
ERROR message=UNIQUE constraint failed: index 'idx_segments_single_open'
ERROR code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

### 2e — migration hazard: creating the index over violating data

If a database somehow already holds two open segments, the `CREATE UNIQUE INDEX` in the migration **fails**, and
because migrations run in a transaction the whole migration rolls back:

```sql
-- against a table already containing two rows with ended_at IS NULL
CREATE UNIQUE INDEX idx_segments_single_open
  ON segments((CASE WHEN ended_at IS NULL THEN 1 END)) WHERE ended_at IS NULL;
```

```
ERROR message=UNIQUE constraint failed: index 'idx_segments_single_open'
ERROR code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

This is correct-but-sharp behaviour. It only bites a future migration that adds the index to an existing database, not
migration 001 which creates the table empty. If the index is ever *re*-created in a later migration, that migration must
close stray open segments first or it will hard-fail on the user's machine with no path forward.

## Experiment 3 — close the first, then open another

Permitted, as required.

```sql
-- 3a
UPDATE segments SET ended_at = 5000 WHERE ended_at IS NULL;
```

```
OK (no error)
```

```sql
-- 3b
SELECT count(*) AS open_count FROM segments WHERE ended_at IS NULL;
```

```
OK -> [{"open_count":0}]
```

```sql
-- 3c
INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (1, 5000, NULL, 5000, 'checkin', 5000, 5000);
```

```
OK (no error)
```

### 3e — the real switch path, close and open in one transaction

This is the section 5.2 worked example ("switched to Beta / Fix, since 09:40"). Order matters: close first, then open.

```sql
BEGIN;
UPDATE segments SET ended_at = 6000, confirmed_through = 6000 WHERE ended_at IS NULL;
INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (2, 6000, NULL, 6000, 'checkin', 6000, 6000);
COMMIT;
SELECT count(*) AS open_count FROM segments WHERE ended_at IS NULL;
```

```
OK (no error)     -- BEGIN
OK (no error)     -- UPDATE
OK (no error)     -- INSERT
OK (no error)     -- COMMIT
OK -> [{"open_count":1}]
```

**The uniqueness is checked per statement, not deferred to COMMIT.** SQLite has no `DEFERRABLE INITIALLY DEFERRED` for
unique indexes. The switch transaction therefore *must* close the old segment before inserting the new one; opening
first and closing second fails mid-transaction even though the end state would be legal. Write the repository method in
that order and note it, because the reverse order is the natural way to phrase "start tracking Beta, and by the way stop
Acme."

## Experiment 4 — two root buckets with the same name

Rejected. The `COALESCE(parent_id, -1)` sentinel does its job: two `NULL` parents compare equal.

```sql
INSERT INTO buckets (parent_id,name,depth,created_at,updated_at)
     VALUES (NULL,'Acme',0,2000,2000);
```

```
ERROR name=Error
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
ERROR code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

The index key values, showing the sentinel:

```sql
SELECT COALESCE(parent_id,-1) AS key, name, is_archived FROM buckets ORDER BY id;
```

```
OK -> [{"key":-1,"name":"Break / Away","is_archived":0},{"key":-1,"name":"Acme","is_archived":0},{"key":2,"name":"Build","is_archived":0},{"key":1,"name":"Build","is_archived":0}]
```

Duplicate under the same non-null parent — also rejected:

```sql
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (10,2,'Build',1,2000,2000);   -- OK
INSERT INTO buckets (parent_id,name,depth,created_at,updated_at)    VALUES (2,'Build',1,2000,2000);
```

```
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
```

Same name under a *different* parent — correctly allowed:

```sql
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (11,1,'Build',1,2000,2000);
```

```
OK (no error)
```

### Note on the `-1` sentinel

`-1` is safe here only because `buckets.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, which SQLite only ever assigns
monotonically increasing positive values. A row explicitly inserted with `id = -1` would make a root bucket and a child
of bucket `-1` collide. Nothing in the schema forbids that. It is a theoretical hole, not a practical one, but the
repository layer should simply never write an explicit negative id.

## Experiment 5 — same name, one archived

Permitted, as the partial index intends. Archived buckets are outside the index entirely.

```sql
-- 5a: archived duplicate of the live root "Acme"
INSERT INTO buckets (id,parent_id,name,depth,is_archived,created_at,updated_at)
     VALUES (20,NULL,'Acme',0,1,3000,3000);
```

```
OK (no error)
```

```sql
-- 5b: a SECOND archived duplicate
INSERT INTO buckets (id,parent_id,name,depth,is_archived,created_at,updated_at)
     VALUES (21,NULL,'Acme',0,1,3000,3000);
```

```
OK (no error)
```

```sql
SELECT id,parent_id,name,is_archived FROM buckets WHERE name='Acme' ORDER BY id;
```

```
OK -> [{"id":2,"parent_id":null,"name":"Acme","is_archived":0},{"id":20,"parent_id":null,"name":"Acme","is_archived":1},{"id":21,"parent_id":null,"name":"Acme","is_archived":1}]
```

Archived duplicates may stack without limit. That is the correct trade — history is preserved — but it means
**un-archiving can fail**, which is a UI path that must be handled rather than assumed:

```sql
-- 5d: un-archive a bucket whose name is taken by a live sibling
UPDATE buckets SET is_archived = 0 WHERE id = 20;
```

```
ERROR name=Error
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
ERROR code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

```sql
SELECT id,name,is_archived FROM buckets WHERE id=20;
```

```
OK -> [{"id":20,"name":"Acme","is_archived":1}]
```

Un-archive is not a safe no-questions operation. The UI should either pre-check for a live sibling of the same name and
offer a rename, or surface the mapped message from the table below.

## Experiment 6 — reparenting

The index behaves correctly across moves. Each of these is an `UPDATE` of `parent_id`, and the index is re-evaluated.

**6b — move into a parent that already has that name: rejected.**

```sql
-- bucket 11 is "Build" under parent 1; parent 2 already has "Build" (id 10)
UPDATE buckets SET parent_id = 2 WHERE id = 11;
```

```
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
```

```sql
SELECT id,parent_id,name FROM buckets WHERE id IN (10,11);
```

```
OK -> [{"id":10,"parent_id":2,"name":"Build"},{"id":11,"parent_id":1,"name":"Build"}]
```

No partial move — the statement is atomic.

**6c — move into a parent with no clash: allowed.**

```sql
UPDATE buckets SET parent_id = 10, depth = 2 WHERE id = 11;
```

```
OK (no error)
```

**6d — move a child up to root where a live root of that name exists: rejected.**

```sql
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (30,2,'Acme',1,4000,4000);  -- OK
UPDATE buckets SET parent_id = NULL, depth = 0 WHERE id = 30;
```

```
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
```

The `COALESCE` sentinel works in the move direction too, not just on insert.

**6e — vacate a name and reuse it in one transaction: allowed.**

```sql
BEGIN;
UPDATE buckets SET parent_id = 1 WHERE id = 10;                                                    -- move "Build" away from parent 2
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (40,2,'Build',1,5000,5000);
COMMIT;
```

```
OK (no error)  x4
```

Sequential statements within one transaction are fine, because each statement individually leaves the index consistent.

**6f — swapping two sibling names in a single UPDATE: rejected.**

```sql
-- buckets 50 and 51 are siblings named 'AAA' and 'BBB'
UPDATE buckets SET name = CASE name WHEN 'AAA' THEN 'BBB' ELSE 'AAA' END WHERE id IN (50,51);
```

```
ERROR message=UNIQUE constraint failed: index 'idx_buckets_sibling_name'
```

```sql
SELECT id,name FROM buckets WHERE id IN (50,51) ORDER BY id;
```

```
OK -> [{"id":50,"name":"AAA"},{"id":51,"name":"BBB"}]
```

This is the one genuinely awkward result. Uniqueness is enforced **row by row within a statement**, so the intermediate
state collides even though the final state is legal. If the UI ever allows swapping or rotating sibling names, the
repository must stage through a temporary name. Rolled back cleanly, at least.

**6g — the index is case- and whitespace-sensitive.** All of these were accepted as distinct siblings under one parent:

```sql
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (61,1,'Zed',1,7000,7000);   -- OK
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (62,1,'zed',1,7000,7000);   -- OK
INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (63,1,'Zed ',1,7000,7000);  -- OK
```

`name` has no `COLLATE NOCASE`, so `"Zed"`, `"zed"` and `"Zed "` are three different buckets. Users will read that as a
bug. Decide deliberately: either trim and case-fold in the repository before writing, or declare
`name TEXT NOT NULL COLLATE NOCASE`. Note that `COLLATE NOCASE` is ASCII-only in SQLite and still would not trim
whitespace, so repository-side normalisation is the more honest fix.

## The trap: do not "simplify" `idx_segments_single_open`

The `CASE` expression looks redundant. It is not. Several formulations were tested against the identical
two-open-segment scenario:

| Formulation | Second open segment |
|---|---|
| `ON segments((CASE WHEN ended_at IS NULL THEN 1 END)) WHERE ended_at IS NULL` — **BUILD_PLAN form** | rejected |
| `ON segments(ended_at) WHERE ended_at IS NULL` — the obvious simplification | **ACCEPTED — enforces nothing** |
| `ON segments((CASE WHEN ended_at IS NULL THEN 1 END))` — no partial clause | rejected |
| `ON segments((1)) WHERE ended_at IS NULL` | rejected |
| `ON segments((COALESCE(ended_at,0))) WHERE ended_at IS NULL` | rejected |

```
### B. naive: unique on the nullable column itself
DDL: CREATE UNIQUE INDEX ix ON segments(ended_at) WHERE ended_at IS NULL;
  create: OK
  first open: OK
  second open: OK  <-- ENFORCES NOTHING
```

The reason is the SQL rule that **`NULL` values are always distinct in a unique index**. Indexing `ended_at` itself
stores `NULL` for every open segment, and no two `NULL`s ever collide. The `CASE` exists precisely to replace those
distinct `NULL`s with a constant `1`, which does collide. The BUILD_PLAN form is correct and should carry a comment
saying so — it already carries one about defence-in-depth; it should also say *do not remove the CASE*.

## Error strings for the repository layer

Every string below is copied from an actual thrown error. Match on **`errcode`** plus the **index or constraint name**,
never on the whole message.

| Condition | `errcode` | Literal `message` | Suggested user-facing message |
|---|---|---|---|
| Second open segment (insert or re-open) | `2067` | `UNIQUE constraint failed: index 'idx_segments_single_open'` | "Something is already being tracked. Stop or switch it first." |
| Duplicate sibling bucket name (insert, move, or un-archive) | `2067` | `UNIQUE constraint failed: index 'idx_buckets_sibling_name'` | "A bucket named X already exists here. Pick a different name." |
| Zero-length or reversed segment | `275` | `CHECK constraint failed: ended_at IS NULL OR ended_at > started_at` | "A segment must end after it starts." |
| Bad `origin` value | `275` | `CHECK constraint failed: origin IN` + newline + the literal list from the DDL | internal bug — log, do not surface |
| `depth` outside 0–3 | `275` | `CHECK constraint failed: depth BETWEEN 0 AND 3` | "Buckets can only be nested four levels deep." |
| Bad `kind` | `275` | `CHECK constraint failed: kind IN ('work','break')` | internal bug |
| Bad `is_archived` | `275` | `CHECK constraint failed: is_archived IN (0,1)` | internal bug |
| Bad `source` | `275` | `CHECK constraint failed: source IN ('local','workday')` | internal bug |
| Delete a bucket that has segments or children | `1811` | `FOREIGN KEY constraint failed` | "This bucket still has tracked time. Archive it instead." |

The `origin` message deserves its own block, because it contains the DDL's literal line break and indentation:

```
CHECK constraint failed: origin IN
                      ('manual','checkin','idle_resolution','recovery','edit','split')
```

That alone should discourage matching CHECK messages by text.

`errcode` values are the SQLite extended result codes: `2067` = `SQLITE_CONSTRAINT_UNIQUE`, `275` =
`SQLITE_CONSTRAINT_CHECK`, `1811` = `SQLITE_CONSTRAINT_FOREIGNKEY`. Under `node:sqlite` these arrive as `err.errcode`,
with `err.code` always the generic string `'ERR_SQLITE_ERROR'` and `err.errstr` always the useless
`'constraint failed'`. **`err.code` is not discriminating — do not switch on it.** Under `better-sqlite3` the same
numeric value arrives as `err.code` in its string form (`'SQLITE_CONSTRAINT_UNIQUE'`); the `message` text is identical
because it comes from the engine. An error mapper should therefore key off the message's index/constraint name, which is
stable across both bindings.

### Two warnings about the CHECK and FK messages

**1. `FOREIGN KEY constraint failed` names nothing.** There is no table, column, or constraint in it. A delete blocked
by `segments.bucket_id` and a delete blocked by `buckets.parent_id` are textually identical:

```sql
DELETE FROM buckets WHERE id = 2;   -- has segments
DELETE FROM buckets WHERE id = 1;   -- has child buckets AND segments
```

```
ERROR message=FOREIGN KEY constraint failed   (both)
ERROR code=ERR_SQLITE_ERROR  errcode=1811  errstr=constraint failed
```

Section 5.4 says to "let it throw and surface a clear message," but the engine gives nothing to build that message from.
The repository must query which dependency exists before, or after, catching the error in order to say something useful.

**2. The unnamed CHECK message text is version-dependent.** This is the one place the version genuinely matters:

| SQLite | message for the same violating insert |
|---|---|
| 3.49.1 | `CHECK constraint failed: ended_at IS NULL OR ended_at > started_at` |
| 3.22.0 | `CHECK constraint failed: segments` |

Older SQLite reported the *table* name for an unnamed CHECK; newer reports the expression source text. Either could
change again, and re-formatting the DDL whitespace changes the newer string. **Name the constraints** and the text
becomes stable — verified identical on both engines:

```sql
CONSTRAINT segment_ends_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
```

```
3.22.0 -> CHECK constraint failed: segment_ends_after_start
3.49.1 -> CHECK constraint failed: segment_ends_after_start
```

Recommend adding `CONSTRAINT <name>` to every CHECK in section 6 before migration 001 ships, since migrations are
forward-only and the DDL cannot be edited afterwards. The UNIQUE index messages need no such treatment — they already
carry the index name and were byte-identical on both versions.

## Other section 6 findings

Bonus observations from building the schema, in rough order of how much they matter.

### `PRAGMA foreign_keys` is per-connection and off by default — this is the sharpest edge

`ON DELETE RESTRICT` is worth exactly nothing on a connection that forgot the pragma. Demonstrated:

```sql
PRAGMA foreign_keys = OFF;
DELETE FROM buckets WHERE id = 2;
```

```
OK (no error)
```

```sql
SELECT count(*) AS orphan_segments FROM segments s LEFT JOIN buckets b ON b.id = s.bucket_id WHERE b.id IS NULL;
```

```
OK -> [{"orphan_segments":3}]
```

```sql
PRAGMA foreign_key_check;
```

```
OK -> [{"table":"segments","rowid":1,"parent":"buckets","fkid":0},{"table":"segments","rowid":2,"parent":"buckets","fkid":0},{"table":"segments","rowid":4,"parent":"buckets","fkid":0},{"table":"buckets","rowid":30,"parent":"buckets","fkid":0},{"table":"buckets","rowid":40,"parent":"buckets","fkid":0}]
```

Three orphaned segments and two orphaned bucket parents, silently, with no error at any point. BUILD_PLAN already says
"enable on every connection," and this is why. Worth enforcing in a single chokepoint that opens the database, and worth
asserting `PRAGMA foreign_keys` returns `1` immediately after opening — the pragma is a **no-op inside a transaction**,
so a connection helper that opens a transaction before setting it would fail silently. Note the contrast with the two
UNIQUE indexes, which need no pragma and cannot be switched off.

### The CHECK constraints and FKs otherwise behave as section 5 assumes

- `CHECK (ended_at IS NULL OR ended_at > started_at)` correctly rejects both zero-length (`9000, 9000`) and reversed
  (`9000, 8000`) segments, satisfying invariant 5.1.4.
- All five enum-style CHECKs (`origin`, `kind`, `is_archived`, `source`, `depth`) reject bad values.
- `ON DELETE RESTRICT` blocks deleting a bucket with segments and a bucket with children (with the pragma on).
- Deleting an unreferenced bucket is allowed.
- `checkins.segment_id ON DELETE SET NULL` works: after deleting segment 900,
  `SELECT id,segment_id FROM checkins WHERE id=1` returned `[{"id":1,"segment_id":null}]`.

### AUTOINCREMENT does not reuse ids

Confirmed, which matters because `id` is the fallback seed for deterministic bucket colours (section 5.4) and because a
reused id would silently re-colour a different bucket.

```sql
INSERT INTO buckets (parent_id,name,depth,created_at,updated_at) VALUES (NULL,'Temp',0,1,1);
SELECT MAX(id) AS max_id FROM buckets;   -- 71
DELETE FROM buckets WHERE name='Temp';
INSERT INTO buckets (parent_id,name,depth,created_at,updated_at) VALUES (NULL,'Temp2',0,1,1);
SELECT id,name FROM buckets WHERE name='Temp2';
```

```
OK -> [{"id":72,"name":"Temp2"}]
```

Id 71 was not reused. `sqlite_sequence` carries the high-water mark. (Plain `INTEGER PRIMARY KEY` without
`AUTOINCREMENT` *would* have reused 71 — the keyword is load-bearing here, not decoration.)

The absolute ids depend on how many rows ran before, so the trimmed script in [Reproducing](#reproducing) prints a
different pair (`64` then `65`). The behaviour under test — *N* deleted, next insert gets *N+1*, never *N* — is the same.

### Smaller notes

- `PRAGMA integrity_check` returned `ok` and `REINDEX` completed without disturbing the single open segment, so the
  expression index rebuilds cleanly.
- Nothing in the schema enforces invariant 5.1.2 (**no overlaps**) or 5.1.5 (**`confirmed_through` within bounds**).
  Those are repository-only, with no storage-layer safety net at all — unlike 5.1.1, which now demonstrably has one.
  Overlap in particular cannot be expressed as a SQLite CHECK or unique index; if defence-in-depth is wanted there it
  would have to be a trigger. Flagging the asymmetry, not proposing it.
- `schema_meta` has no `PRIMARY KEY` or uniqueness on `version`, so nothing stops a double-applied migration from
  inserting the same version twice. Cheap to harden.

## Reproducing

The full probe is the script below. It needs only Node 22+ (for `node:sqlite`) and writes nothing to disk — the database
is `:memory:`. Older Node may need `node --experimental-sqlite probe.mjs`.

```js
// probe.mjs — empirical probe of BUILD_PLAN section 6 schema indexes.
// Usage: node probe.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
let step = 0;
const log = (...a) => console.log(...a);

function run(sql, label) {
  step++;
  log(`\n--- [${step}] ${label ?? ''}`);
  log('SQL:');
  log(sql.trim());
  try {
    if (/^\s*(select|pragma|explain)/i.test(sql)) {
      log('OK -> ' + JSON.stringify(db.prepare(sql).all()));
    } else {
      db.exec(sql);
      log('OK (no error)');
    }
    return { ok: true };
  } catch (e) {
    log(`ERROR name=${e.name}`);
    log(`ERROR message=${e.message}`);
    log(`ERROR code=${e.code}  errcode=${e.errcode}  errstr=${e.errstr}`);
    return { ok: false, e };
  }
}

log('sqlite_version=' + db.prepare('select sqlite_version() v').get().v);
log('sqlite_source_id=' + db.prepare('select sqlite_source_id() v').get().v);

run(`PRAGMA journal_mode = WAL;`);
run(`PRAGMA foreign_keys = ON;`);
run(`PRAGMA busy_timeout = 5000;`);

// ---- section 6 schema, verbatim ----
run(`CREATE TABLE schema_meta (
  version    INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);`);
run(`CREATE TABLE buckets (
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
);`);
run(`CREATE INDEX idx_buckets_parent ON buckets(parent_id);`);
run(`CREATE UNIQUE INDEX idx_buckets_sibling_name
  ON buckets(COALESCE(parent_id, -1), name) WHERE is_archived = 0;`);
run(`CREATE TABLE segments (
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
);`);
run(`CREATE INDEX idx_segments_started ON segments(started_at);`);
run(`CREATE INDEX idx_segments_bucket  ON segments(bucket_id);`);
run(`CREATE UNIQUE INDEX idx_segments_single_open
  ON segments((CASE WHEN ended_at IS NULL THEN 1 END))
  WHERE ended_at IS NULL;`);
run(`CREATE TABLE checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id   INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  prompted_at  INTEGER NOT NULL,
  responded_at INTEGER,
  response     TEXT CHECK (response IN
                 ('same','switched','stopped','break','snoozed','dismissed','timeout')),
  created_at   INTEGER NOT NULL
);`);

run(`SELECT partial FROM pragma_index_list('segments') WHERE name='idx_segments_single_open';`);

run(`INSERT INTO buckets (id,parent_id,name,depth,kind,is_system,created_at,updated_at)
     VALUES (1,NULL,'Break / Away',0,'break',1,1000,1000);`);
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at)
     VALUES (2,NULL,'Acme',0,1000,1000);`);

// ---- 2: two open segments ----
run(`INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (2, 1000, NULL, 1000, 'manual', 1000, 1000);`, '2a first open');
run(`INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (1, 2000, NULL, 2000, 'manual', 2000, 2000);`, '2b second open - expect reject');
run(`INSERT INTO segments (bucket_id,started_at,ended_at,origin,created_at,updated_at)
     VALUES (2, 100, 200, 'manual', 100, 100);`, '2d-i closed segment');
run(`UPDATE segments SET ended_at = NULL WHERE started_at = 100;`, '2d-ii re-open - expect reject');

// ---- 3: close then open ----
run(`UPDATE segments SET ended_at = 5000 WHERE ended_at IS NULL;`, '3a close');
run(`SELECT count(*) AS open_count FROM segments WHERE ended_at IS NULL;`, '3b');
run(`INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (1, 5000, NULL, 5000, 'checkin', 5000, 5000);`, '3c new open - expect allow');
run(`BEGIN;`);
run(`UPDATE segments SET ended_at = 6000, confirmed_through = 6000 WHERE ended_at IS NULL;`, '3e close');
run(`INSERT INTO segments (bucket_id,started_at,ended_at,confirmed_through,origin,created_at,updated_at)
     VALUES (2, 6000, NULL, 6000, 'checkin', 6000, 6000);`, '3e open');
run(`COMMIT;`);

// ---- 4: duplicate sibling names ----
run(`INSERT INTO buckets (parent_id,name,depth,created_at,updated_at)
     VALUES (NULL,'Acme',0,2000,2000);`, '4 duplicate root - expect reject');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at)
     VALUES (10,2,'Build',1,2000,2000);`, '4c-i');
run(`INSERT INTO buckets (parent_id,name,depth,created_at,updated_at)
     VALUES (2,'Build',1,2000,2000);`, '4c-ii duplicate child - expect reject');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at)
     VALUES (11,1,'Build',1,2000,2000);`, '4d different parent - expect allow');
run(`SELECT COALESCE(parent_id,-1) AS key, name, is_archived FROM buckets ORDER BY id;`, '4e');

// ---- 5: archived duplicates ----
run(`INSERT INTO buckets (id,parent_id,name,depth,is_archived,created_at,updated_at)
     VALUES (20,NULL,'Acme',0,1,3000,3000);`, '5a - expect allow');
run(`INSERT INTO buckets (id,parent_id,name,depth,is_archived,created_at,updated_at)
     VALUES (21,NULL,'Acme',0,1,3000,3000);`, '5b second archived dup - expect allow');
run(`UPDATE buckets SET is_archived = 0 WHERE id = 20;`, '5d un-archive - expect reject');

// ---- 6: reparenting ----
run(`UPDATE buckets SET parent_id = 2 WHERE id = 11;`, '6b move into clash - expect reject');
run(`SELECT id,parent_id,name FROM buckets WHERE id IN (10,11);`, '6b no partial move');
run(`UPDATE buckets SET parent_id = 10, depth = 2 WHERE id = 11;`, '6c clean move - expect allow');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at)
     VALUES (30,2,'Acme',1,4000,4000);`, '6d-i');
run(`UPDATE buckets SET parent_id = NULL, depth = 0 WHERE id = 30;`, '6d-ii move to root clash - expect reject');
run(`BEGIN;`);
run(`UPDATE buckets SET parent_id = 1 WHERE id = 10;`, '6e vacate');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at)
     VALUES (40,2,'Build',1,5000,5000);`, '6e reuse - expect allow');
run(`COMMIT;`);
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (50,1,'AAA',1,6000,6000);`);
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (51,1,'BBB',1,6000,6000);`);
run(`UPDATE buckets SET name = CASE name WHEN 'AAA' THEN 'BBB' ELSE 'AAA' END
     WHERE id IN (50,51);`, '6f swap - expect reject');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (61,1,'Zed',1,7000,7000);`);
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (62,1,'zed',1,7000,7000);`, '6g case');
run(`INSERT INTO buckets (id,parent_id,name,depth,created_at,updated_at) VALUES (63,1,'Zed ',1,7000,7000);`, '6g whitespace');

// ---- bonus: CHECKs, FKs, AUTOINCREMENT ----
run(`INSERT INTO segments (bucket_id,started_at,ended_at,origin,created_at,updated_at)
     VALUES (2, 9000, 9000, 'manual', 1, 1);`, 'B1 zero-length - expect reject');
run(`INSERT INTO segments (bucket_id,started_at,origin,created_at,updated_at)
     VALUES (2, 9500, 'bogus', 1, 1);`, 'B2 bad origin - expect reject');
run(`INSERT INTO buckets (parent_id,name,depth,created_at,updated_at) VALUES (NULL,'TooDeep',4,1,1);`, 'B2 depth 4');
run(`DELETE FROM buckets WHERE id = 2;`, 'B3 RESTRICT - expect reject');
run(`PRAGMA foreign_keys = OFF;`);
run(`DELETE FROM buckets WHERE id = 2;`, 'B3 RESTRICT with pragma off - expect ALLOWED');
run(`SELECT count(*) AS orphan_segments FROM segments s
     LEFT JOIN buckets b ON b.id = s.bucket_id WHERE b.id IS NULL;`);
run(`PRAGMA foreign_keys = ON;`);
run(`PRAGMA foreign_key_check;`);
run(`INSERT INTO buckets (parent_id,name,depth,created_at,updated_at) VALUES (NULL,'Temp',0,1,1);`);
run(`SELECT MAX(id) AS max_id FROM buckets;`);
run(`DELETE FROM buckets WHERE name='Temp';`);
run(`INSERT INTO buckets (parent_id,name,depth,created_at,updated_at) VALUES (NULL,'Temp2',0,1,1);`);
run(`SELECT id,name FROM buckets WHERE name='Temp2';`, 'B4 id must NOT be reused');

// ---- the trap: index formulations compared ----
for (const [label, ddl] of [
  ['A. BUILD_PLAN form', `CREATE UNIQUE INDEX ix ON segments((CASE WHEN ended_at IS NULL THEN 1 END)) WHERE ended_at IS NULL;`],
  ['B. naive simplification', `CREATE UNIQUE INDEX ix ON segments(ended_at) WHERE ended_at IS NULL;`],
  ['C. no partial clause', `CREATE UNIQUE INDEX ix ON segments((CASE WHEN ended_at IS NULL THEN 1 END));`],
  ['D. constant literal', `CREATE UNIQUE INDEX ix ON segments((1)) WHERE ended_at IS NULL;`],
  ['E. COALESCE form', `CREATE UNIQUE INDEX ix ON segments((COALESCE(ended_at,0))) WHERE ended_at IS NULL;`],
]) {
  const d = new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE segments (id INTEGER PRIMARY KEY, started_at INTEGER, ended_at INTEGER);`);
  log(`\n### ${label}\nDDL: ${ddl}`);
  d.exec(ddl);
  d.exec(`INSERT INTO segments (started_at,ended_at) VALUES (1,NULL);`);
  try {
    d.exec(`INSERT INTO segments (started_at,ended_at) VALUES (2,NULL);`);
    log('  second open: OK  <-- ENFORCES NOTHING');
  } catch (e) {
    log('  second open REJECTED: ' + e.message);
  }
}
```

The 3.22.0 cross-check ran the same scenario through the `sqlite3` CLI; its full output is in the next section.

## Version sensitivity

Identical index behaviour on 3.22.0 and 3.49.1 — every rejection and every acceptance matched. Literal 3.22.0 output:

```
sqlite_version=3.22.0
--E2a first open
--E2b second open (expect reject)
--E3 close then reopen (expect allow)
open_count=1
--E4 duplicate root name (expect reject)
--E5 archived duplicate (expect allow)
--E5 unarchive into collision (expect reject)
--E6 reparent into collision (expect reject)
--B3 ON DELETE RESTRICT (expect reject)
--B1 zero-length CHECK (expect reject)
--done
Error: near line 11: UNIQUE constraint failed: index 'idx_segments_single_open'
Error: near line 17: UNIQUE constraint failed: index 'idx_buckets_sibling_name'
Error: near line 21: UNIQUE constraint failed: index 'idx_buckets_sibling_name'
Error: near line 24: UNIQUE constraint failed: index 'idx_buckets_sibling_name'
Error: near line 26: FOREIGN KEY constraint failed
Error: near line 28: CHECK constraint failed: segments
```

The only difference across 27 minor versions is the last line — the unnamed CHECK message, as discussed above. The
UNIQUE index messages, including the index names, are byte-identical.

## Not verified

- **The SQLite version Electron actually ships.** No SQLite binding is declared in `app/package.json` yet and Electron
  is not installed in this checkout. The binding decision is still open, so this could not be pinned down. Re-confirm
  the two index messages once a binding is chosen — the check is one `SELECT sqlite_version();` plus one duplicate
  insert.
- **`better-sqlite3` specifically.** Not installed. Its error *message* text comes from the engine and will match; its
  error *object shape* differs (`err.code` is the string `'SQLITE_CONSTRAINT_UNIQUE'` rather than
  `'ERR_SQLITE_ERROR'`). That claim about the object shape is from the binding's documented behaviour, not measured
  here.
- **Behaviour under WAL and real concurrency.** All tests ran on `:memory:`, where `PRAGMA journal_mode = WAL` silently
  returns `memory`. Two processes racing to open a segment were not tested. The unique index is enforced by the engine
  under any journal mode, so the conclusion should hold, but the busy/locked path was not exercised.
