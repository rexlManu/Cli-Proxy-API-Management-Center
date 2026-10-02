import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { buildTimelineLane } from '../quotaTimelineModel';
import { summarizeQuotaLanes } from '../ledger';
import styles from './QuotaSummary.module.scss';

type QuotaSummaryProps = {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
};

export function QuotaSummary({ entries, quotaFor, resolvedTheme }: QuotaSummaryProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  return (
    <div className={styles.summary}>
      {QUOTA_TAB_ORDER.map((provider) => {
        const accounts = entries.filter((entry) => entry.type === provider);
        if (!accounts.length) return null;
        const lanes = accounts.map((entry) =>
          buildTimelineLane({
            name: entry.file.name,
            displayName: '',
            provider,
            quota: quotaFor(entry),
          })
        );
        const total = summarizeQuotaLanes(lanes, now);
        const reset = buildResetDisplay(null, total.resetAtMs, now, i18n.resolvedLanguage);
        const icon = getAuthFileIcon(provider, resolvedTheme);
        return (
          <section key={provider} className={styles.provider}>
            <div className={styles.heading}>
              {icon && <img src={icon} alt="" width={20} height={20} />}
              <h2>{getTypeLabel(t, provider)}</h2>
              <span>{t('quota_management.summary_credentials', { count: accounts.length })}</span>
            </div>
            <p className={styles.label}>{t('quota_management.weekly_limit')}</p>
            <div className={styles.total}>
              <strong>{total.remaining === null ? '--' : `${Math.round(total.remaining)}%`}</strong>
              {total.knownCount > 0 && (
                <span>{t('quota_management.summary_total', { total: total.capacity })}</span>
              )}
            </div>
            <div className={styles.segments}>
              {lanes.map((lane, index) => (
                <div key={accounts[index].file.name} className={styles.track}>
                  <div
                    className={styles.fill}
                    style={{
                      width: `${lane.remaining ?? 0}%`,
                      background:
                        lane.remaining !== null && lane.remaining < 30
                          ? 'var(--danger-color)'
                          : lane.remaining !== null && lane.remaining < 70
                            ? 'var(--quota-medium-color)'
                            : 'var(--success-color)',
                    }}
                  />
                </div>
              ))}
            </div>
            {reset && (
              <p className={styles.reset} title={t('quota_management.next_reset')}>
                {reset.relative} <span>{reset.absolute}</span>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
