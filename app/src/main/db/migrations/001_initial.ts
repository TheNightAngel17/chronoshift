import type Database from 'better-sqlite3'

const DEFAULT_SETTINGS: ReadonlyArray<readonly [string, unknown]> = [
  ['checkin_interval_minutes', 15],
  ['idle_threshold_minutes', 5],
  ['snooze_minutes', 5],
  ['auto_stop_after_hours', 12],
  ['week_start_day', 1],
  ['grid_start_hour', 6],
  ['grid_end_hour', 20],
  ['grid_snap_minutes', 5],
  ['prompt_steal_focus', true],
  ['prompt_sound', false],
  ['autostart_enabled', true],
  ['autostart_begin_tracking', false],
  ['theme', 'system']
]

export function applyInitialMigration(database: Database.Database): void {
  const now = Date.now()

  database.exec(`
    CREATE TABLE schema_meta (
      version    INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE buckets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id     INTEGER REFERENCES buckets(id) ON DELETE RESTRICT,
      name          TEXT    NOT NULL,
      depth         INTEGER NOT NULL CONSTRAINT bucket_depth_in_range CHECK (depth BETWEEN 0 AND 3),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      color         TEXT,
      kind          TEXT    NOT NULL DEFAULT 'work' CONSTRAINT bucket_kind_valid CHECK (kind IN ('work','break')),
      is_system     INTEGER NOT NULL DEFAULT 0 CONSTRAINT bucket_is_system_boolean CHECK (is_system IN (0,1)),
      is_archived   INTEGER NOT NULL DEFAULT 0 CONSTRAINT bucket_is_archived_boolean CHECK (is_archived IN (0,1)),
      source        TEXT    NOT NULL DEFAULT 'local' CONSTRAINT bucket_source_valid CHECK (source IN ('local','workday')),
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
      origin            TEXT    NOT NULL CONSTRAINT segment_origin_valid CHECK (origin IN
                          ('manual','checkin','idle_resolution','recovery','edit','split')),
      note              TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      CONSTRAINT segment_ends_after_start CHECK (ended_at IS NULL OR ended_at > started_at)
    );
    CREATE INDEX idx_segments_started ON segments(started_at);
    CREATE INDEX idx_segments_bucket  ON segments(bucket_id);
    CREATE UNIQUE INDEX idx_segments_single_open
      ON segments((CASE WHEN ended_at IS NULL THEN 1 END))
      WHERE ended_at IS NULL;

    CREATE TABLE checkins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id   INTEGER REFERENCES segments(id) ON DELETE SET NULL,
      prompted_at  INTEGER NOT NULL,
      responded_at INTEGER,
      response     TEXT CONSTRAINT checkin_response_valid CHECK (response IN
                     ('same','switched','stopped','break','snoozed','dismissed','timeout')),
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX idx_checkins_prompted ON checkins(prompted_at);

    CREATE TABLE idle_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER NOT NULL,
      cause       TEXT NOT NULL CONSTRAINT idle_event_cause_valid CHECK (cause IN ('inactivity','lock','suspend','app_gone')),
      resolution  TEXT CONSTRAINT idle_event_resolution_valid CHECK (resolution IN ('kept','break','reassigned','split','unresolved')),
      resolved_at INTEGER,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_idle_started ON idle_events(started_at);

    CREATE TABLE settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE app_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  database
    .prepare(
      `
      INSERT INTO buckets (
        parent_id,
        name,
        depth,
        kind,
        is_system,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(null, 'Break / Away', 0, 'break', 1, now, now)

  const insertSetting = database.prepare(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `
  )

  for (const [key, value] of DEFAULT_SETTINGS) {
    insertSetting.run(key, JSON.stringify(value), now)
  }
}
