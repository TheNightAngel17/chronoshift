import type Database from 'better-sqlite3'
import type { Settings, Theme } from '../../../shared/types'
import { getDatabase } from '../connection'

type SettingsRow = {
  key: string
  value: string
}

type SettingsKey = keyof Settings

const SETTING_KEYS = {
  checkinIntervalMinutes: 'checkin_interval_minutes',
  idleThresholdMinutes: 'idle_threshold_minutes',
  snoozeMinutes: 'snooze_minutes',
  autoStopAfterHours: 'auto_stop_after_hours',
  weekStartDay: 'week_start_day',
  gridStartHour: 'grid_start_hour',
  gridEndHour: 'grid_end_hour',
  gridSnapMinutes: 'grid_snap_minutes',
  promptStealFocus: 'prompt_steal_focus',
  promptSound: 'prompt_sound',
  autostartEnabled: 'autostart_enabled',
  autostartBeginTracking: 'autostart_begin_tracking',
  theme: 'theme'
} as const satisfies Record<SettingsKey, string>

const DB_KEY_TO_SETTINGS_KEY = Object.fromEntries(
  Object.entries(SETTING_KEYS).map(([settingsKey, dbKey]) => [dbKey, settingsKey])
) as Record<string, SettingsKey>

function failValidation(message: string): never {
  throw new Error(`Invalid setting value: ${message}`)
}

function assertIntegerAtLeast(value: unknown, minimum: number, key: string): void {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    failValidation(`${key} must be an integer >= ${minimum}`)
  }
}

function assertIntegerBetween(value: unknown, minimum: number, maximum: number, key: string): void {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    failValidation(`${key} must be an integer between ${minimum} and ${maximum}`)
  }
}

function assertBoolean(value: unknown, key: string): void {
  if (typeof value !== 'boolean') {
    failValidation(`${key} must be a boolean`)
  }
}

function assertTheme(value: unknown): asserts value is Theme {
  if (value !== 'system' && value !== 'light' && value !== 'dark') {
    failValidation('theme must be one of "system", "light", or "dark"')
  }
}

function validateSettings(settings: Settings): void {
  assertIntegerAtLeast(settings.checkinIntervalMinutes, 1, 'checkinIntervalMinutes')
  assertIntegerAtLeast(settings.idleThresholdMinutes, 1, 'idleThresholdMinutes')
  assertIntegerAtLeast(settings.snoozeMinutes, 1, 'snoozeMinutes')
  assertIntegerAtLeast(settings.autoStopAfterHours, 1, 'autoStopAfterHours')
  assertIntegerBetween(settings.weekStartDay, 0, 6, 'weekStartDay')
  assertIntegerBetween(settings.gridStartHour, 0, 23, 'gridStartHour')
  assertIntegerBetween(settings.gridEndHour, 1, 24, 'gridEndHour')
  if (settings.gridStartHour >= settings.gridEndHour) {
    failValidation('gridStartHour must be less than gridEndHour')
  }
  assertIntegerBetween(settings.gridSnapMinutes, 1, 60, 'gridSnapMinutes')
  assertBoolean(settings.promptStealFocus, 'promptStealFocus')
  assertBoolean(settings.promptSound, 'promptSound')
  assertBoolean(settings.autostartEnabled, 'autostartEnabled')
  assertBoolean(settings.autostartBeginTracking, 'autostartBeginTracking')
  assertTheme(settings.theme)
}

function parseSettingValue(row: SettingsRow): unknown {
  try {
    return JSON.parse(row.value)
  } catch (error) {
    throw new Error(`Invalid stored JSON for setting "${row.key}"`, { cause: error })
  }
}

function getRequiredSettingValue(
  rowsByKey: ReadonlyMap<SettingsKey, unknown>,
  key: SettingsKey
): unknown {
  if (!rowsByKey.has(key)) {
    throw new Error(`Missing setting row for "${SETTING_KEYS[key]}"`)
  }

  return rowsByKey.get(key)
}

function toSettings(rows: ReadonlyArray<SettingsRow>): Settings {
  const rowsByKey = new Map<SettingsKey, unknown>()

  for (const row of rows) {
    const settingsKey = DB_KEY_TO_SETTINGS_KEY[row.key]
    if (!settingsKey) {
      throw new Error(`Unknown setting key "${row.key}"`)
    }

    rowsByKey.set(settingsKey, parseSettingValue(row))
  }

  const settings: Settings = {
    checkinIntervalMinutes: getRequiredSettingValue(rowsByKey, 'checkinIntervalMinutes') as number,
    idleThresholdMinutes: getRequiredSettingValue(rowsByKey, 'idleThresholdMinutes') as number,
    snoozeMinutes: getRequiredSettingValue(rowsByKey, 'snoozeMinutes') as number,
    autoStopAfterHours: getRequiredSettingValue(rowsByKey, 'autoStopAfterHours') as number,
    weekStartDay: getRequiredSettingValue(rowsByKey, 'weekStartDay') as number,
    gridStartHour: getRequiredSettingValue(rowsByKey, 'gridStartHour') as number,
    gridEndHour: getRequiredSettingValue(rowsByKey, 'gridEndHour') as number,
    gridSnapMinutes: getRequiredSettingValue(rowsByKey, 'gridSnapMinutes') as number,
    promptStealFocus: getRequiredSettingValue(rowsByKey, 'promptStealFocus') as boolean,
    promptSound: getRequiredSettingValue(rowsByKey, 'promptSound') as boolean,
    autostartEnabled: getRequiredSettingValue(rowsByKey, 'autostartEnabled') as boolean,
    autostartBeginTracking: getRequiredSettingValue(rowsByKey, 'autostartBeginTracking') as boolean,
    theme: getRequiredSettingValue(rowsByKey, 'theme') as Theme
  }

  validateSettings(settings)

  return settings
}

function hasSettingKey(key: string): key is SettingsKey {
  return Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)
}

export function getAll(database: Database.Database = getDatabase()): Settings {
  const rows = database
    .prepare<[], SettingsRow>(
      `
        SELECT key, value
        FROM settings
      `
    )
    .all()

  return toSettings(rows)
}

export function set<K extends SettingsKey>(
  key: K,
  value: Settings[K],
  database: Database.Database = getDatabase()
): Settings {
  if (!hasSettingKey(key)) {
    throw new Error(`Unknown setting key "${key}"`)
  }

  const nextSettings = {
    ...getAll(database),
    [key]: value
  } as Settings

  validateSettings(nextSettings)

  database
    .prepare(
      `
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(SETTING_KEYS[key], JSON.stringify(nextSettings[key]), Date.now())

  return nextSettings
}
