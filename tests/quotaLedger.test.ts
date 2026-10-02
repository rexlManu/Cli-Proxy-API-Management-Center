import { describe, expect, test } from 'bun:test';
import { maskQuotaEmail, summarizeQuotaLanes } from '@/features/quota/ledger';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';

describe('quota ledger', () => {
  test('hides addresses in filenames and keeps non-email identities', () => {
    expect(maskQuotaEmail('claude-test@example.dev.json')).toBe('claude-t•••@e•••.dev.json');
    expect(maskQuotaEmail('codex-account.json')).toBe('codex-account.json');
  });
  test('unknown and expired resets do not become empty quotas or upcoming resets', () => {
    const lane = buildTimelineLane({
      name: 'a',
      displayName: '',
      provider: 'claude',
      quota: undefined,
    });
    const result = summarizeQuotaLanes(
      [
        { ...lane, remaining: 58, anchorMs: 2000 },
        { ...lane, remaining: 100, anchorMs: 500 },
        lane,
      ],
      1000
    );
    expect(result).toEqual({ remaining: 158, capacity: 200, knownCount: 2, resetAtMs: 2000 });
    expect(summarizeQuotaLanes([lane], 1000).remaining).toBeNull();
  });
});
