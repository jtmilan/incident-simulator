import {
  BURN_ALERT_FOR_MS,
  BURN_RATE_PAGE,
  DB_PRIMARY_DOWN_FOR_MS,
  POD_NOT_READY_AFTER_MS,
} from './config.ts';
import type { AlertLifecycle, AlertName, AlertSeverity, AlertState, SimState, TickContext } from './types.ts';

interface AlertRule {
  name: AlertName;
  severity: AlertSeverity;
  forMs: number;
  summary: (state: SimState) => string;
  condition: (state: SimState, t: number) => boolean;
}

// Prometheus-style rules evaluated every tick. The `</> real config` drawer shows the production
// PrometheusRule these stand in for (Workbook 1h/5m windows, 15m KubePodNotReady).
export const ALERT_RULES: readonly AlertRule[] = [
  {
    name: 'HighErrorBudgetBurn',
    severity: 'page',
    forMs: BURN_ALERT_FOR_MS,
    summary: (s) => `checkout-api is burning its error budget ${Math.round(s.slo.burnLong)}× (60s) / ${Math.round(s.slo.burnShort)}× (5s)`,
    condition: (s) => s.slo.burnLong >= BURN_RATE_PAGE && s.slo.burnShort >= BURN_RATE_PAGE,
  },
  {
    name: 'DBPrimaryDown',
    severity: 'page',
    forMs: DB_PRIMARY_DOWN_FOR_MS,
    summary: (s) => `Postgres primary ${s.db.instances.find((i) => i.role === 'primary')?.id ?? '?'} is not accepting connections`,
    condition: (s) => s.db.instances.some((i) => i.role === 'primary' && !i.up),
  },
  {
    name: 'PodNotReady',
    severity: 'ticket',
    forMs: 0,
    summary: (s) => `${s.pods.filter((p) => p.status !== 'Ready' && p.status !== 'Terminating').length} checkout-api pod(s) not Ready for over 30s`,
    condition: (s, t) => s.pods.some((p) => p.status !== 'Ready' && p.status !== 'Terminating' && t - p.createdAt > POD_NOT_READY_AFTER_MS),
  },
];

export function initialAlerts(): AlertState[] {
  return ALERT_RULES.map((rule) => ({
    name: rule.name,
    severity: rule.severity,
    state: 'inactive',
    summary: '',
    pendingSince: null,
    firedAt: null,
    resolvedAt: null,
  }));
}

function transition(alert: AlertState, to: AlertLifecycle, ctx: TickContext) {
  const from = alert.state;
  alert.state = to;
  ctx.emit({ type: 'alertStateChanged', t: ctx.t, name: alert.name, from, to, alert: { ...alert } });
}

/** inactive → pending (condition true) → firing (after `for`) → resolved back to inactive. */
export function evaluateAlerts(state: SimState, ctx: TickContext): void {
  for (const rule of ALERT_RULES) {
    const alert = state.alerts.find((a) => a.name === rule.name)!;
    const active = rule.condition(state, ctx.t);

    if (active) {
      if (alert.state === 'inactive') {
        alert.pendingSince = ctx.t;
        alert.summary = rule.summary(state);
        transition(alert, 'pending', ctx);
      }
      if (alert.state === 'pending' && ctx.t - alert.pendingSince! >= rule.forMs) {
        alert.firedAt = ctx.t;
        alert.summary = rule.summary(state);
        transition(alert, 'firing', ctx);
        ctx.log('alertmanager', 'crit', `FIRING [${rule.severity}] ${rule.name}: ${alert.summary}`);
      }
    } else if (alert.state === 'firing') {
      alert.resolvedAt = ctx.t;
      transition(alert, 'inactive', ctx);
      ctx.log('alertmanager', 'ok', `RESOLVED ${rule.name}`);
    } else if (alert.state === 'pending') {
      alert.pendingSince = null;
      transition(alert, 'inactive', ctx);
    }
  }
}
