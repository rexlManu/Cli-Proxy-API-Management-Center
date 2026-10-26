/**
 * Quota history maths: remaining capacity, drain rate and forecast.
 *
 * Pure functions over the samples the proxy records (GET /quota/history). No
 * React and no clock of its own: `now` is always passed in.
 *
 * Only the weekly window is charted. Weekly capacity is what a few Pro
 * accounts add up to, and it resets on a known schedule, so it can be forecast.
 */

import { HOUR_MS } from '@/utils/time/durations';

/** One reading from the proxy. Times are unix seconds. */
export interface QuotaHistorySample {
  t: number;
  auth: string;
  provider: string;
  window: string;
  /** Consumed share of the window, 0..100. */
  used: number;
  reset_at: number;
  period_hours?: number;
}

export interface SeriesPoint {
  tMs: number;
  /** Null marks a gap: no history covers this moment. */
  value: number | null;
}

/** A reading for one credential. */
interface Reading {
  tMs: number;
  remaining: number;
  resetAtMs: number;
}

/** Two readings further apart than this are not treated as continuous. */
const MAX_GAP_MS = 30 * 60_000;
/** A reset moves the reset time forward by about a period; allow clock jitter. */
const RESET_JITTER_MS = 5 * 60_000;
const WEEK_HOURS = 168;
const WEEK_MS = WEEK_HOURS * HOUR_MS;

/** The weekly window of one provider. Claude names it "7d"; Codex states its length. */
function isWeekly(sample: QuotaHistorySample, provider: string): boolean {
  if (sample.provider !== provider) return false;
  return provider === 'claude'
    ? sample.window === '7d'
    : (sample.period_hours ?? 0) >= WEEK_HOURS - 1;
}

/** Weekly readings per credential, oldest first. */
export function weeklyReadings(
  samples: readonly QuotaHistorySample[],
  provider: string
): Map<string, Reading[]> {
  const byAuth = new Map<string, Reading[]>();
  for (const s of samples) {
    if (!isWeekly(s, provider)) continue;
    const list = byAuth.get(s.auth) ?? [];
    list.push({ tMs: s.t * 1000, remaining: 100 - s.used, resetAtMs: s.reset_at * 1000 });
    byAuth.set(s.auth, list);
  }
  for (const list of byAuth.values()) list.sort((a, b) => a.tMs - b.tMs);
  return byAuth;
}

/** How much a credential consumed between two readings, or null across a reset or gap. */
function drainBetween(a: Reading, b: Reading): number | null {
  if (b.tMs <= a.tMs || b.tMs - a.tMs > MAX_GAP_MS || a.resetAtMs <= b.tMs) return null;
  if (b.resetAtMs > a.resetAtMs + RESET_JITTER_MS || b.remaining > a.remaining) return null;
  return a.remaining - b.remaining;
}

interface Drain {
  tMs: number;
  amount: number;
  /** Credential this was consumed from. */
  auth: string;
  /** Time the two readings cover. */
  spanMs: number;
}

function drains(readings: Map<string, Reading[]>): Drain[] {
  const out: Drain[] = [];
  for (const [auth, list] of readings) {
    for (let i = 1; i < list.length; i++) {
      const amount = drainBetween(list[i - 1], list[i]);
      if (amount !== null) {
        out.push({ tMs: list[i].tMs, amount, auth, spanMs: list[i].tMs - list[i - 1].tMs });
      }
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}

/** Total remaining across credentials at each step. Gaps in a credential's history carry its last reading. */
export function remainingSeries(
  readings: Map<string, Reading[]>,
  fromMs: number,
  toMs: number,
  stepMs: number
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    let sum = 0;
    let known = false;
    for (const list of readings.values()) {
      // Latest reading at or before t, only while it is recent enough to mean something.
      let last: Reading | undefined;
      for (const r of list) {
        if (r.tMs > t) break;
        last = r;
      }
      if (last && t - last.tMs <= MAX_GAP_MS * 2) {
        sum += last.remaining;
        known = true;
      }
    }
    out.push({ tMs: t, value: known ? sum : null });
  }
  return out;
}

/** Percent consumed per hour, as a one-hour trailing average. Resets are excluded; no data is a gap. */
export function drainSeries(
  readings: Map<string, Reading[]>,
  fromMs: number,
  toMs: number,
  stepMs: number
): SeriesPoint[] {
  const all = drains(readings);
  const out: SeriesPoint[] = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const inWindow = all.filter((d) => d.tMs > t - HOUR_MS && d.tMs <= t);
    out.push({
      tMs: t,
      value: inWindow.length ? inWindow.reduce((sum, d) => sum + d.amount, 0) : null,
    });
  }
  return out;
}

/** Average consumption per hour over the last `windowMs`, counting only time with history. */
export function averageDrainPerHour(
  readings: Map<string, Reading[]>,
  nowMs: number,
  windowMs: number
): number | null {
  const recent = drains(readings).filter((d) => d.tMs > nowMs - windowMs && d.tMs <= nowMs);
  let total = 0;
  let known = false;
  for (const [auth, list] of readings) {
    const last = list[list.length - 1];
    if (!last || nowMs - last.tMs > MAX_GAP_MS * 2 || last.tMs > nowMs) continue;
    const mine = recent.filter((d) => d.auth === auth);
    const coveredMs = mine.reduce((sum, d) => sum + d.spanMs, 0);
    if (coveredMs <= 0) continue;
    total += (mine.reduce((sum, d) => sum + d.amount, 0) / coveredMs) * HOUR_MS;
    known = true;
  }
  return known ? total : null;
}

export interface Forecast {
  points: SeriesPoint[];
  /** Soonest upcoming reset and how much capacity it gives back. */
  nextReset: { tMs: number; gain: number } | null;
}

/**
 * Projects total remaining capacity over the next `spanMs`.
 *
 * Each credential keeps draining at the rate it showed over the last day, down
 * to empty, and returns to full at its reset times, one period apart.
 */
export function forecastRemaining(
  readings: Map<string, Reading[]>,
  nowMs: number,
  spanMs: number,
  stepMs: number
): Forecast {
  const dayDrains = drains(readings).filter((d) => d.tMs > nowMs - 24 * HOUR_MS);
  const projections = [...readings].flatMap(([auth, list]) => {
    const last = list[list.length - 1];
    if (!last || nowMs - last.tMs > MAX_GAP_MS * 2 || last.tMs > nowMs) return [];
    const mine = dayDrains.filter((d) => d.auth === auth);
    const coveredMs = mine.reduce((sum, d) => sum + d.spanMs, 0);
    const perMs = coveredMs > 0 ? mine.reduce((sum, d) => sum + d.amount, 0) / coveredMs : 0;
    return [{ remaining: last.remaining, readAtMs: last.tMs, resetAtMs: last.resetAtMs, perMs }];
  });

  let nextReset: Forecast['nextReset'] = null;
  for (const p of projections) {
    if (p.resetAtMs <= nowMs || p.resetAtMs > nowMs + spanMs) continue;
    const gain = 100 - Math.max(0, p.remaining - p.perMs * (p.resetAtMs - p.readAtMs));
    if (!nextReset || p.resetAtMs < nextReset.tMs) nextReset = { tMs: p.resetAtMs, gain };
    else if (p.resetAtMs === nextReset.tMs) nextReset.gain += gain;
  }
  const valueAt = (t: number) =>
    projections.reduce((sum, p) => {
      let remaining = p.remaining;
      let from = p.readAtMs;
      let reset = p.resetAtMs;
      while (reset <= t) {
        remaining = 100;
        from = Math.max(from, reset);
        reset += WEEK_MS;
      }
      return sum + Math.max(0, remaining - p.perMs * (t - from));
    }, 0);

  const points: SeriesPoint[] = [];
  if (projections.length) {
    for (let t = nowMs; t <= nowMs + spanMs; t += stepMs)
      points.push({ tMs: t, value: valueAt(t) });
  }
  return { points, nextReset };
}
