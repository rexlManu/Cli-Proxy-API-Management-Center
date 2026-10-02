import type { TimelineLane } from './quotaTimelineModel';

/** Hide the address in credential filenames until the user chooses to show it. */
export function maskQuotaEmail(name: string): string {
  return name.replace(/([\w.+-]+)@([\w.-]+)/g, (_, local: string, domain: string) => {
    const providerPrefix = local.match(/^(claude|codex)-/i)?.[0] ?? '';
    const initial = local.slice(providerPrefix.length, providerPrefix.length + 1);
    const [host, ...suffix] = domain.split('.');
    return `${providerPrefix}${initial}•••@${host.slice(0, 1)}•••${suffix.length ? `.${suffix.join('.')}` : ''}`;
  });
}

/** Unknown quotas stay unknown and do not count as empty accounts. */
export function summarizeQuotaLanes(lanes: readonly TimelineLane[], now: number) {
  const known = lanes.filter((lane) => lane.remaining !== null);
  const resets = lanes.flatMap((lane) =>
    lane.anchorMs !== null && lane.anchorMs > now ? [lane.anchorMs] : []
  );
  return {
    remaining: known.length ? known.reduce((sum, lane) => sum + (lane.remaining ?? 0), 0) : null,
    capacity: known.length * 100,
    knownCount: known.length,
    resetAtMs: resets.length ? Math.min(...resets) : null,
  };
}
