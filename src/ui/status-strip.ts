import type { Loop } from '../app/loop.ts';
import type { Simulation } from '../sim/simulation.ts';
import type { MetricsPoint, SimState } from '../sim/types.ts';

export type StatusLevel = 'ok' | 'degraded' | 'paging';

export interface SystemStatus {
  level: StatusLevel;
  label: string;
  text: string;
}

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

/** One line that says how the platform is doing right now, for the strip at the top of every page. */
export function systemStatus(state: Readonly<SimState>, latest: MetricsPoint | null): SystemStatus {
  const head = `SLO ${pct(state.slo.target, 1)} · budget ${pct(state.slo.budgetRemaining)}`;
  const paging = state.alerts.filter((a) => a.severity === 'page' && a.state === 'firing');
  if (paging.length > 0) {
    return { level: 'paging', label: 'PAGING', text: `${head} · ${paging.map((a) => a.name).join(', ')}` };
  }
  const alerting = state.alerts.some((a) => a.state !== 'inactive');
  const unhealthy = latest !== null && (latest.errorRatio > 0.001 || latest.p99 > 300);
  if (alerting || unhealthy) return { level: 'degraded', label: 'DEGRADED', text: `${head} · degraded` };
  return { level: 'ok', label: 'OK', text: `${head} · all systems normal` };
}

/** Keeps the status strip current from the shared clock, a few times a second, with textContent only. */
export function mountStatusStrip(root: HTMLElement, { sim, loop }: { sim: Simulation; loop: Loop }): () => void {
  const label = root.querySelector<HTMLElement>('[data-status-label]');
  const text = root.querySelector<HTMLElement>('[data-status-text]');
  let last = '';
  let lastDraw = Number.NEGATIVE_INFINITY;
  return loop.add((_dt, now) => {
    if (now - lastDraw < 250) return;
    lastDraw = now;
    const status = systemStatus(sim.state, sim.latest);
    const key = `${status.level}|${status.text}`;
    if (key === last) return;
    last = key;
    root.dataset.level = status.level;
    if (label) label.textContent = status.label;
    if (text) text.textContent = status.text;
  });
}
