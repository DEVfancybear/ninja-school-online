import { describe, expect, it } from 'vitest';
import { fieldBossWindow, m7UtcDay, type FieldBossSchedule } from './m7.js';

const stamp = (value: string): number => Date.parse(value);

describe('M7 UTC schedule and claim day', () => {
  it('opens at minute 00 and closes exactly at minute 15; end boundary is exclusive', () => {
    expect(fieldBossWindow(stamp('2026-01-01T12:00:00.000Z'))).toEqual({
      startsAt: stamp('2026-01-01T12:00:00.000Z'),
      endsAt: stamp('2026-01-01T12:15:00.000Z'),
      active: true,
    });
    expect(fieldBossWindow(stamp('2026-01-01T12:14:59.999Z')).active).toBe(true);
    expect(fieldBossWindow(stamp('2026-01-01T12:15:00.000Z'))).toEqual({
      startsAt: stamp('2026-01-01T13:00:00.000Z'),
      endsAt: stamp('2026-01-01T13:15:00.000Z'),
      active: false,
    });
  });

  it('returns the next UTC opening before a window and across an hour/day boundary', () => {
    expect(fieldBossWindow(stamp('2026-01-01T11:59:59.999Z')).startsAt)
      .toBe(stamp('2026-01-01T12:00:00.000Z'));
    expect(fieldBossWindow(stamp('2026-01-01T23:59:59.999Z')).startsAt)
      .toBe(stamp('2026-01-02T00:00:00.000Z'));
  });

  it('uses an explicit operator schedule instead of assuming local server time', () => {
    const schedule: FieldBossSchedule = { intervalMinutes: 120, windowMinutes: 30, startOffsetMinutes: 30 };
    expect(fieldBossWindow(stamp('2026-01-01T00:29:59.999Z'), schedule)).toEqual({
      startsAt: stamp('2026-01-01T00:30:00.000Z'),
      endsAt: stamp('2026-01-01T01:00:00.000Z'),
      active: false,
    });
    expect(fieldBossWindow(stamp('2026-01-01T00:30:00.000Z'), schedule).active).toBe(true);
    expect(fieldBossWindow(stamp('2026-01-01T01:00:00.000Z'), schedule).startsAt)
      .toBe(stamp('2026-01-01T02:30:00.000Z'));
  });

  it('rolls event daily claims at 00:00 UTC, not local midnight', () => {
    expect(m7UtcDay(stamp('2026-01-01T23:59:59.999Z'))).toBe('2026-01-01');
    expect(m7UtcDay(stamp('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });
});
