import { describe, expect, test } from 'bun:test';
import {
  averageDrainPerHour,
  drainSeries,
  forecastRemaining,
  weeklyReadings,
  type QuotaHistorySample,
} from '../src/features/quota/quotaHistoryModel';

const HOUR = 3_600_000;
const T0 = 1_800_000_000; // unix seconds
const RESET = T0 + 100 * 3600;

const sample = (
  auth: string,
  minute: number,
  used: number,
  resetAt = RESET
): QuotaHistorySample => ({
  t: T0 + minute * 60,
  auth,
  provider: 'claude',
  window: '7d',
  used,
  reset_at: resetAt,
});

describe('quota history model', () => {
  test('keeps only the weekly window of the chosen provider', () => {
    const readings = weeklyReadings(
      [
        sample('a', 0, 10),
        { ...sample('a', 0, 50), window: '5h' },
        { ...sample('b', 0, 1), provider: 'codex' },
      ],
      'claude'
    );
    expect([...readings.keys()]).toEqual(['a']);
    expect(readings.get('a')).toHaveLength(1);
  });

  test('drain skips resets and gaps', () => {
    const readings = weeklyReadings(
      [
        sample('a', 0, 10),
        sample('a', 10, 16), // 6% in 10 minutes
        sample('a', 20, 2, RESET + 168 * 3600), // reset: not drain
        sample('a', 120, 8), // gap of 100 minutes: not drain
      ],
      'claude'
    );
    const at = T0 * 1000 + 120 * 60_000;
    const series = drainSeries(readings, at - 2 * HOUR, at, 10 * 60_000);
    const values = series.map((p) => p.value).filter((v) => v !== null);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === 6)).toBe(true);
  });

  test('forecast refills at the reset time', () => {
    const readings = weeklyReadings([sample('a', 0, 90), sample('a', 30, 90)], 'claude');
    const now = T0 * 1000 + 30 * 60_000;
    const { points, nextReset } = forecastRemaining(readings, now, 120 * HOUR, 6 * HOUR);
    expect(points[0].value).toBe(10);
    expect(nextReset?.tMs).toBe(RESET * 1000);
    expect(nextReset?.gain).toBe(90);
    expect(points[points.length - 1].value).toBe(100);
  });

  test('average drain counts only covered time', () => {
    const readings = weeklyReadings([sample('a', 0, 10), sample('a', 30, 13)], 'claude');
    const now = T0 * 1000 + 30 * 60_000;
    expect(averageDrainPerHour(readings, now, 24 * HOUR)).toBe(6);
  });

  test('adds the drain rates of all fresh accounts', () => {
    const readings = weeklyReadings(
      [sample('a', 0, 10), sample('a', 30, 15), sample('b', 0, 20), sample('b', 30, 25)],
      'claude'
    );
    expect(averageDrainPerHour(readings, T0 * 1000 + HOUR / 2, 24 * HOUR)).toBe(20);
  });

  test('excludes stale accounts from forecasts and current drain', () => {
    const readings = weeklyReadings([sample('a', 0, 10), sample('a', 30, 15)], 'claude');
    const now = T0 * 1000 + 2 * HOUR;
    expect(forecastRemaining(readings, now, 7 * 24 * HOUR, HOUR)).toEqual({
      points: [],
      nextReset: null,
    });
    expect(averageDrainPerHour(readings, now, 24 * HOUR)).toBeNull();
  });

  test('projects consumption since the last reading and adds simultaneous resets', () => {
    const reset = T0 + 3600;
    const readings = weeklyReadings(
      [
        sample('a', 0, 10, reset),
        sample('a', 30, 15, reset),
        sample('b', 0, 10, reset),
        sample('b', 30, 15, reset),
      ],
      'claude'
    );
    const forecast = forecastRemaining(readings, T0 * 1000 + 45 * 60_000, 2 * HOUR, HOUR / 4);
    expect(forecast.points[0].value).toBe(165);
    expect(forecast.nextReset).toEqual({ tMs: reset * 1000, gain: 40 });
    expect(forecast.points[1].value).toBe(200);
  });

  test('does not count drain across the recorded reset boundary', () => {
    const readings = weeklyReadings(
      [sample('a', 0, 10, T0 + 15 * 60), sample('a', 30, 20, T0 + 15 * 60)],
      'claude'
    );
    expect(averageDrainPerHour(readings, T0 * 1000 + HOUR / 2, HOUR)).toBeNull();
  });
});
