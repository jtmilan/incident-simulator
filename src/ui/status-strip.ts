import type { Loop } from '../app/loop.ts';
import { HEALTHY_ERROR_RATIO, HEALTHY_P99_MS } from '../sim/config.ts';
import type { Simulation } from '../sim/simulation.ts';
import type { MetricsPoint, SimState } from '../sim/types.ts';
import { percent as pct } from './view-models.ts';

export type StatusLevel = 'ok' | 'degraded' | 'paging';

export interface SystemStatus {
  level: StatusLevel;
  label: string;
  text: string;
}


/** One line that says how the platform is doing right now, for the strip at the top of every page. */
export function systemStatus(state: Readonly<SimState>, latest: MetricsPoint | null): SystemStatus {
  const head = `SLO ${pct(state.slo.target, 1)} · budget ${pct(state.slo.budgetRemaining)}`;
  const paging = state.alerts.filter((a) => a.severity === 'page' && a.state === 'firing');
  if (paging.length > 0) {
    return { level: 'paging', label: 'PAGING', text: `${head} · ${paging.map((a) => a.name).join(', ')}` };
  }
  const alerting = state.alerts.some((a) => a.state !== 'inactive');
  const unhealthy = latest !== null && (latest.errorRatio > HEALTHY_ERROR_RATIO || latest.p99 > HEALTHY_P99_MS);
  if (alerting || unhealthy) return { level: 'degraded', label: 'DEGRADED', text: `${head} · degraded` };
  return { level: 'ok', label: 'OK', text: `${head} · all systems normal` };
}

/**
 * Keeps every status line (the strip at the top, the footer) current from the shared clock, a few
 * times a second: one computation for all of them, textContent only.
 */
export function mountStatusStrip(roots: readonly HTMLElement[], { sim, loop }: { sim: Simulation; loop: Loop }): () => void {
  const views = roots.map((root) => ({
    root,
    label: root.querySelector<HTMLElement>('[data-status-label]'),
    text: root.querySelector<HTMLElement>('[data-status-text]'),
  }));
  let last = '';
  let lastDraw = Number.NEGATIVE_INFINITY;
  return loop.add((_dt, now) => {
    if (now - lastDraw < 250) return;
    lastDraw = now;
    const status = systemStatus(sim.state, sim.latest);
    const key = `${status.level}|${status.text}`;
    if (key === last) return;
    last = key;
    for (const { root, label, text } of views) {
      root.dataset.level = status.level;
      if (label) label.textContent = status.label;
      if (text) text.textContent = status.text;
    }
  });
}
