import type { QuotaHistorySample } from '@/features/quota/quotaHistoryModel';
import { apiClient } from './client';

export const quotaHistoryApi = {
  /** Samples recorded by the proxy since the given unix-seconds time. */
  list: async (sinceSeconds: number): Promise<QuotaHistorySample[]> => {
    const payload = await apiClient.get<{ samples?: QuotaHistorySample[] }>('/quota/history', {
      params: { since: sinceSeconds },
    });
    return payload.samples ?? [];
  },
};
