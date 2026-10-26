/**
 * Small SVG line chart for quota history. A solid history line, an optional
 * dashed forecast, and a hover readout. No animation, so it never repaints on
 * its own.
 */

import { useState } from 'react';
import type { PointerEvent } from 'react';
import type { SeriesPoint } from '../quotaHistoryModel';
import styles from './QuotaHistoryChart.module.scss';

const WIDTH = 1000;
const HEIGHT = 240;
const PAD = { left: 46, right: 8, top: 10, bottom: 26 };

interface QuotaHistoryChartProps {
  label: string;
  history: readonly SeriesPoint[];
  forecast?: readonly SeriesPoint[];
  fromMs: number;
  toMs: number;
  yMax: number;
  color: string;
  nowMs?: number;
  /** Label for the Now marker. */
  nowLabel?: string;
  formatY: (value: number) => string;
  formatX: (tMs: number) => string;
  /** Text for the hover readout. */
  formatHover: (point: SeriesPoint, projected: boolean) => string;
}

/** Splits a series into runs without gaps, so gaps are drawn as breaks. */
function runs(points: readonly SeriesPoint[]): SeriesPoint[][] {
  const out: SeriesPoint[][] = [];
  let run: SeriesPoint[] = [];
  for (const p of points) {
    if (p.value === null) {
      if (run.length) out.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) out.push(run);
  return out;
}

export function QuotaHistoryChart({
  label,
  history,
  forecast = [],
  fromMs,
  toMs,
  yMax,
  color,
  nowMs,
  nowLabel,
  formatY,
  formatX,
  formatHover,
}: QuotaHistoryChartProps) {
  const [hover, setHover] = useState<{ point: SeriesPoint; projected: boolean } | null>(null);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (tMs: number) => PAD.left + ((tMs - fromMs) / (toMs - fromMs)) * plotW;
  const y = (value: number) => PAD.top + (1 - Math.min(value, yMax) / yMax) * plotH;
  const path = (run: readonly SeriesPoint[]) =>
    run
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.tMs).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`)
      .join('');

  const yTicks = [0, 1, 2, 3, 4].map((i) => (yMax * i) / 4);
  const xTicks = [0, 1, 2, 3, 4].map((i) => fromMs + ((toMs - fromMs) * i) / 4);

  const selectable = [
    ...history.filter((p) => p.value !== null).map((point) => ({ point, projected: false })),
    ...forecast.map((point) => ({ point, projected: true })),
  ];
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const tMs =
      fromMs +
      ((((event.clientX - box.left) / box.width) * WIDTH - PAD.left) / plotW) * (toMs - fromMs);
    let best: (typeof selectable)[number] | null = null;
    for (const candidate of selectable) {
      if (!best || Math.abs(candidate.point.tMs - tMs) < Math.abs(best.point.tMs - tMs))
        best = candidate;
    }
    setHover(best);
  };

  return (
    <div className={styles.wrap}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svg}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className={styles.grid}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className={styles.tick} x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
              {formatY(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick, i) => (
          <text
            key={tick}
            className={styles.tick}
            x={x(tick)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {formatX(tick)}
          </text>
        ))}
        {runs(history).map((run) => (
          <g key={run[0].tMs}>
            <path
              d={`${path(run)}L${x(run[run.length - 1].tMs)},${y(0)}L${x(run[0].tMs)},${y(0)}Z`}
              fill={color}
              fillOpacity={0.12}
            />
            <path d={path(run)} fill="none" stroke={color} strokeWidth={2} />
          </g>
        ))}
        {forecast.length > 0 && (
          <path
            d={path(forecast)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        )}
        {nowMs !== undefined && nowMs >= fromMs && nowMs <= toMs && (
          <g>
            <line
              className={styles.now}
              x1={x(nowMs)}
              x2={x(nowMs)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
            {nowLabel && (
              <text className={styles.tick} x={x(nowMs) + 6} y={PAD.top + 12}>
                {nowLabel}
              </text>
            )}
          </g>
        )}
        {hover && hover.point.value !== null && (
          <g>
            <line
              className={styles.cursor}
              x1={x(hover.point.tMs)}
              x2={x(hover.point.tMs)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke={color}
            />
            <circle cx={x(hover.point.tMs)} cy={y(hover.point.value)} r={4} fill={color} />
          </g>
        )}
      </svg>
      {hover && <div className={styles.readout}>{formatHover(hover.point, hover.projected)}</div>}
    </div>
  );
}
