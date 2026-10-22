/** M7 content values are deterministic defaults; operators may change these before deployment. */
export const GUILD_NAME_MAX_LENGTH = 24;
export const GUILD_MAX_MEMBERS = 20;
export const GUILD_MAX_LEVEL = 20;
export const GUILD_LEVEL_EXP = 100;

/** First event stays enabled continuously; all daily claims reset at 00:00 UTC. */
export const M7_EVENT_ID = 'm7-first-event';
export const M7_EVENT_ENABLED = true;
export const M7_EVENT_QUEST_ID = 'm7-first-monster';
export const M7_EVENT_QUEST_KILL_TARGET = 1;
export const M7_LOGIN_REWARD = { yen: 100, items: [{ itemId: 'item-banh-bao', qty: 1 }] } as const;
export const M7_QUEST_REWARD = { yen: 250, items: [{ itemId: 'item-tra-rung', qty: 1 }] } as const;

/** Field boss is open for the first 15 minutes of every UTC hour (minute 00 through 14). */
export const FIELD_BOSS_ID = 'mob-thu-vuong';
export const FIELD_BOSS_MAP_ID = 'lang-khoi-nguon';
export const FIELD_BOSS_WINDOW_MINUTES = 15;
export const FIELD_BOSS_INTERVAL_MINUTES = 60;
export const FIELD_BOSS_START_MINUTE_UTC = 0;
export interface FieldBossSchedule {
  readonly intervalMinutes: number;
  readonly windowMinutes: number;
  readonly startOffsetMinutes: number;
}
export const DEFAULT_FIELD_BOSS_SCHEDULE: FieldBossSchedule = {
  intervalMinutes: FIELD_BOSS_INTERVAL_MINUTES,
  windowMinutes: FIELD_BOSS_WINDOW_MINUTES,
  startOffsetMinutes: FIELD_BOSS_START_MINUTE_UTC,
};
/** Scheduled field boss battles support a three-player guild co-op; ordinary PvE stays at two. */
export const FIELD_BOSS_MAX_PLAYERS = 3;

export const FIELD_BOSS_DAILY_LOOT = { itemId: 'item-da-vun', qty: 1 } as const;

/** UTC calendar date used for all M7 daily claim keys; never depends on server local timezone. */
export function m7UtcDay(now: number | Date): string {
  const timestamp = now instanceof Date ? now.getTime() : now;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export interface FieldBossWindow {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly active: boolean;
}

/** Current or next inclusive-start/exclusive-end window; schedule boundaries are UTC. */
export function fieldBossWindow(
  now: number | Date,
  schedule: FieldBossSchedule = DEFAULT_FIELD_BOSS_SCHEDULE,
): FieldBossWindow {
  const timestamp = now instanceof Date ? now.getTime() : now;
  const intervalMs = schedule.intervalMinutes * 60_000;
  const windowMs = schedule.windowMinutes * 60_000;
  const phaseMs = schedule.startOffsetMinutes * 60_000;
  const currentIntervalStart = Math.floor((timestamp - phaseMs) / intervalMs) * intervalMs + phaseMs;
  const currentIntervalEnd = currentIntervalStart + windowMs;
  if (timestamp < currentIntervalEnd) {
    return { startsAt: currentIntervalStart, endsAt: currentIntervalEnd, active: true };
  }
  return {
    startsAt: currentIntervalStart + intervalMs,
    endsAt: currentIntervalStart + intervalMs + windowMs,
    active: false,
  };
}

export function isFieldBossActive(
  now: number | Date,
  schedule: FieldBossSchedule = DEFAULT_FIELD_BOSS_SCHEDULE,
): boolean {
  const window = fieldBossWindow(now, schedule);
  return window.active && (now instanceof Date ? now.getTime() : now) < window.endsAt;
}
