/**
 * Quota history for one provider: remaining capacity with a forecast, and the
 * drain rate. Both read the samples the proxy records, so they fill while no
 * panel is open. All maths lives in quotaHistoryModel.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { quotaHistoryApi } from '@/services/api';
import { useQuotaStore } from '@/stores';
import type { ResolvedTheme } from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { useNow } from '@/hooks/useNow';
import {
  averageDrainPerHour,
  drainSeries,
  forecastRemaining,
  remainingSeries,
  weeklyReadings,
  type QuotaHistorySample,
} from '../quotaHistoryModel';
import { QuotaHistoryChart } from './QuotaHistoryChart';
import styles from './QuotaHistoryPanel.module.scss';

const REFRESH_MS = 5 * 60_000;
const STEP_MS = 30 * 60_000;
/** The remaining chart shows this much past before the forecast starts. */
const PAST_MS = DAY_MS;

type ChartTab = 'remaining' | 'drain';

const FORECAST_DAYS = ['1', '3', '7'] as const;
const DRAIN_HOURS = ['24', '168'] as const;

type QuotaHistoryPanelProps = {
  provider: string;
  resolvedTheme: ResolvedTheme;
};

export function QuotaHistoryPanel({ provider, resolvedTheme }: QuotaHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [samples, setSamples] = useState<QuotaHistorySample[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ChartTab>('remaining');
  const [forecastDays, setForecastDays] = useState<(typeof FORECAST_DAYS)[number]>('7');
  const [drainHours, setDrainHours] = useState<(typeof DRAIN_HOURS)[number]>('24');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const sinceSeconds = Math.floor((Date.now() - 7 * DAY_MS) / 1000);
      quotaHistoryApi
        .list(sinceSeconds)
        .then((next) => {
          if (!cancelled && sessionGeneration === useQuotaStore.getState().cacheGeneration) {
            setSamples(next);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (!cancelled && sessionGeneration === useQuotaStore.getState().cacheGeneration) {
            setStatus('error');
          }
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionGeneration]);

  const readings = useMemo(() => weeklyReadings(samples, provider), [samples, provider]);
  const colorSet = TYPE_COLORS[provider] || TYPE_COLORS.unknown;
  const color = (resolvedTheme === 'dark' && colorSet.dark ? colorSet.dark : colorSet.light).text;
  const locale = i18n.resolvedLanguage;

  const view = useMemo(() => {
    const capacity =
      [...readings.values()].filter((list) => {
      const last = list[list.length - 1];
        return last && last.tMs <= now && now - last.tMs <= HOUR_MS;
      }).length * 100;
    const remaining = remainingSeries(readings, now - PAST_MS, now, STEP_MS);
    const current = remaining[remaining.length - 1]?.value ?? null;
    return {
      capacity,
      current,
      perHour: averageDrainPerHour(readings, now, DAY_MS),
      remaining,
      forecast: forecastRemaining(readings, now, Number(forecastDays) * DAY_MS, STEP_MS),
      drain: drainSeries(readings, now - Number(drainHours) * HOUR_MS, now, STEP_MS),
    };
  }, [readings, now, forecastDays, drainHours]);

  if (readings.size === 0) {
    return (
      <p className={styles.empty}>
        {t(`quota_management.history_${status === 'ready' ? 'empty' : status}`)}
      </p>
    );
  }

  const dayTime = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const hourTime = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const percent = (value: number) => `${Math.round(value * 10) / 10}`;

  const drainPeak = Math.max(0, ...view.drain.map((p) => p.value ?? 0));
  const drainMax = Math.max(5, Math.ceil(drainPeak / 5) * 5);
  const toMs = now + Number(forecastDays) * DAY_MS;
  const gain = view.forecast.nextReset;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <strong style={{ color }}>
          {view.current === null ? '--' : `${Math.round(view.current)}%`}
        </strong>
        <span>{t('quota_management.history_capacity', { total: view.capacity })}</span>
        {view.perHour !== null && (
          <span>{t('quota_management.history_per_hour', { value: percent(view.perHour) })}</span>
        )}
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-label={t('quota_management.history_toggle')}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
        </button>
      </div>

      {open && (
        <>
          <div className={styles.controls}>
            <div role="tablist" className={styles.tabs}>
              {(['remaining', 'drain'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  style={tab === id ? { color, borderColor: color } : undefined}
                  onClick={() => setTab(id)}
                >
                  {t(`quota_management.history_tab_${id}`)}
                </button>
              ))}
            </div>
            <div className={styles.range}>
              {tab === 'remaining' ? (
                <Select
                  size="sm"
                  value={forecastDays}
                  ariaLabel={t('quota_management.history_forecast_range')}
                  options={FORECAST_DAYS.map((value) => ({
                    value,
                    label: t('quota_management.history_next_days', { count: Number(value) }),
                  }))}
                  onChange={(value) => {
                    if (value === '1' || value === '3' || value === '7') setForecastDays(value);
                  }}
                />
              ) : (
                <Select
                  size="sm"
                  value={drainHours}
                  ariaLabel={t('quota_management.history_drain_range')}
                  options={DRAIN_HOURS.map((value) => ({
                    value,
                    label: t(`quota_management.history_last_${value}`),
                  }))}
                  onChange={(value) => {
                    if (value === '24' || value === '168') setDrainHours(value);
                  }}
                />
              )}
            </div>
          </div>

          {tab === 'remaining' ? (
            <>
              <p className={styles.footnote}>{t('quota_management.history_legend')}</p>
              <QuotaHistoryChart
                label={t('quota_management.history_tab_remaining')}
                history={view.remaining}
                forecast={view.forecast.points}
                fromMs={now - PAST_MS}
                toMs={toMs}
                yMax={Math.max(100, view.capacity)}
                color={color}
                nowMs={now}
                nowLabel={t('quota_management.history_now')}
                formatY={(value) => `${Math.round(value)}%`}
                formatX={(tMs) => day.format(tMs)}
                formatHover={(point, projected) =>
                  t(
                    projected
                      ? 'quota_management.history_hover_projected'
                      : 'quota_management.history_hover',
                    {
                      time: dayTime.format(point.tMs),
                      value: percent(point.value ?? 0),
                    }
                  )
                }
              />
              {gain && (
                <p className={styles.footnote}>
                  {t('quota_management.history_next_reset', {
                    gain: Math.round(gain.gain),
                    time: dayTime.format(gain.tMs),
                  })}
                </p>
              )}
            </>
          ) : (
            <>
              <QuotaHistoryChart
                label={t('quota_management.history_tab_drain')}
                history={view.drain}
                fromMs={now - Number(drainHours) * HOUR_MS}
                toMs={now}
                yMax={drainMax}
                color={color}
                formatY={(value) => `${Math.round(value)}`}
                formatX={(tMs) => (Number(drainHours) > 24 ? day : hourTime).format(tMs)}
                formatHover={(point) =>
                  t('quota_management.history_hover_drain', {
                    time: dayTime.format(point.tMs),
                    value: percent(point.value ?? 0),
                  })
                }
              />
              <p className={styles.footnote}>
                {t('quota_management.history_peak', { value: percent(drainPeak) })}
                {' · '}
                {t('quota_management.history_drain_note')}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
