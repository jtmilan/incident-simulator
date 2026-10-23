import { HEALTHY_ERROR_RATIO, HEALTHY_P99_MS, INCIDENT_RECOVERY_HOLD_MS } from './config.ts';
import { isDatabaseSettled } from './database.ts';
import type { IncidentState, Postmortem, SimState, TickContext, TickTraffic } from './types.ts';

export function initialIncident(): IncidentState {
  return {
    active: false,
    startedAt: 0,
    firstPageAt: null,
    budgetAtStart: 1,
    peakErrorRatio: 0,
    peakP99: 0,
    alertsFired: [],
    chaos: [],
    healthySince: null,
  };
}

function isHealthy(state: SimState, t: number, tick: TickTraffic): boolean {
  const desired = state.deployment.desiredReplicas;
  const ready = state.pods.filter((p) => p.status === 'Ready').length;
  const starting = state.pods.some((p) => p.status !== 'Ready' && p.status !== 'Terminating');
  return (
    !state.chaos.some((run) => run.endsAt > t) &&
    state.alerts.every((a) => a.state === 'inactive') &&
    ready >= desired &&
    !starting &&
    isDatabaseSettled(state) &&
    tick.errorRatio < HEALTHY_ERROR_RATIO &&
    tick.p99 < HEALTHY_P99_MS
  );
}

/**
 * Opens an incident on the first chaos or alert, tracks the worst of it, and writes the
 * postmortem once the platform has been healthy for a few seconds.
 */
export function trackIncident(state: SimState, ctx: TickContext, tick: TickTraffic): void {
  const { incident } = state;
  const startedNow = state.chaos.filter((run) => run.startedAt === ctx.t);
  const alerting = state.alerts.filter((a) => a.state !== 'inactive');

  if (!incident.active) {
    if (startedNow.length === 0 && alerting.length === 0) return;
    Object.assign(incident, initialIncident(), {
      active: true,
      startedAt: ctx.t,
      budgetAtStart: state.slo.budgetRemaining,
    });
    ctx.emit({ type: 'incidentOpened', t: ctx.t });
  }

  for (const run of startedNow) if (!incident.chaos.includes(run.kind)) incident.chaos.push(run.kind);
  for (const alert of state.alerts) {
    if (alert.state !== 'firing') continue;
    if (!incident.alertsFired.includes(alert.name)) incident.alertsFired.push(alert.name);
    if (alert.severity === 'page' && incident.firstPageAt === null) incident.firstPageAt = ctx.t;
  }
  incident.peakErrorRatio = Math.max(incident.peakErrorRatio, tick.errorRatio);
  incident.peakP99 = Math.max(incident.peakP99, tick.p99);

  if (!isHealthy(state, ctx.t, tick)) {
    incident.healthySince = null;
    return;
  }
  incident.healthySince ??= ctx.t;
  if (ctx.t - incident.healthySince < INCIDENT_RECOVERY_HOLD_MS) return;

  const postmortem: Postmortem = {
    startedAt: incident.startedAt,
    endedAt: incident.healthySince,
    timeToDetectMs: incident.firstPageAt === null ? null : incident.firstPageAt - incident.startedAt,
    timeToRecoverMs: incident.healthySince - incident.startedAt,
    budgetBurned: incident.budgetAtStart - state.slo.budgetRemaining,
    peakErrorRatio: incident.peakErrorRatio,
    peakP99: incident.peakP99,
    alertsFired: [...incident.alertsFired],
    chaos: [...incident.chaos],
  };
  state.lastPostmortem = postmortem;
  incident.active = false;
  ctx.emit({ type: 'postmortemReady', t: ctx.t, postmortem });
  const paged = postmortem.timeToDetectMs === null ? 'not paged (self-healed)' : `paged after ${Math.round(postmortem.timeToDetectMs / 1_000)} s`;
  ctx.log('sim', 'ok', `Incident resolved in ${Math.round(postmortem.timeToRecoverMs / 1_000)} s, ${paged}. Postmortem ready.`);
}
