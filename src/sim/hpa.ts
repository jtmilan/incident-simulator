import {
  HPA_MAX_REPLICAS,
  HPA_MIN_REPLICAS,
  HPA_SCALE_DOWN_STABILIZATION_MS,
  HPA_SYNC_PERIOD_MS,
  HPA_TARGET_UTILIZATION,
  HPA_TOLERANCE,
} from './config.ts';
import type { HpaState, SimState, TickContext } from './types.ts';

export function initialHpa(): HpaState {
  return {
    minReplicas: HPA_MIN_REPLICAS,
    maxReplicas: HPA_MAX_REPLICAS,
    targetUtilization: HPA_TARGET_UTILIZATION,
    lastSyncAt: 0,
    lastUtilization: null,
    lastScaleAt: null,
    recommendations: [],
    scaleDownHoldUntil: null,
  };
}

/** desired = ceil(readyPods × utilization / target), skipped inside the ±10% tolerance band. */
export function recommend(hpa: HpaState, current: number, readyPods: number, utilization: number): number {
  const ratio = utilization / hpa.targetUtilization;
  if (Math.abs(ratio - 1) <= HPA_TOLERANCE) return current;
  const raw = Math.ceil(readyPods * ratio - 1e-9);
  return Math.min(Math.max(raw, hpa.minReplicas), hpa.maxReplicas);
}

/** Default scale-up policy: per period, at most double or add 4 pods, whichever is larger. */
export function scaleUpLimit(current: number): number {
  return Math.max(current * 2, current + 4);
}

/**
 * HorizontalPodAutoscaler sync. Scale-up acts on the newest recommendation (0 s stabilization);
 * scale-down waits until the highest recommendation of the last 300 s allows it.
 */
export function reconcileHpa(state: SimState, ctx: TickContext, utilization: number, readyPods: number): void {
  const { hpa, deployment } = state;
  // The hold expires on its own; the scale-down itself waits for the next sync.
  if (hpa.scaleDownHoldUntil !== null && ctx.t >= hpa.scaleDownHoldUntil) hpa.scaleDownHoldUntil = null;
  if (ctx.t - hpa.lastSyncAt < HPA_SYNC_PERIOD_MS || readyPods === 0) return;
  hpa.lastSyncAt = ctx.t;
  hpa.lastUtilization = utilization;

  const current = deployment.desiredReplicas;
  const latest = recommend(hpa, current, readyPods, utilization);
  hpa.recommendations.push({ t: ctx.t, replicas: latest });
  hpa.recommendations = hpa.recommendations.filter((r) => r.t > ctx.t - HPA_SCALE_DOWN_STABILIZATION_MS);

  const next =
    latest > current
      ? Math.min(latest, scaleUpLimit(current), hpa.maxReplicas)
      : Math.min(current, Math.max(...hpa.recommendations.map((r) => r.replicas)));

  // A pending scale-down: report when the last higher recommendation leaves the window.
  const higher = hpa.recommendations.filter((r) => r.replicas > latest);
  hpa.scaleDownHoldUntil = latest < next && higher.length > 0 ? higher.at(-1)!.t + HPA_SCALE_DOWN_STABILIZATION_MS : null;

  if (next === current) return;
  deployment.desiredReplicas = next;
  hpa.lastScaleAt = ctx.t;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const direction = next > current ? 'above' : 'below';
  ctx.emit({ type: 'scaled', t: ctx.t, from: current, to: next, utilization });
  ctx.log(
    'hpa',
    'info',
    `HPA ${deployment.name}: New size: ${next} (was ${current}); reason: cpu resource utilization (percentage of request) ${direction} target (${pct(utilization)} / ${pct(hpa.targetUtilization)})`,
  );
}
