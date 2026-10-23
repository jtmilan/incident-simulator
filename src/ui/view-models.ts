import { BURN_RATE_PAGE, SLO_WINDOW_LABEL } from '../sim/config.ts';
import type { ChaosKind, Command, Postmortem, SimState, TimelineEvent } from '../sim/types.ts';

// Plain functions that turn simulator state into what the console shows. No DOM, so they're tested.

export type ActionId = 'killPod' | 'injectErrors' | 'trafficSurge' | 'injectLatency' | 'failoverDatabase';

export interface ActionSpec {
  id: ActionId;
  title: string;
  detail: string;
  glyph: string;
  command: Command;
}

export const ACTIONS: readonly ActionSpec[] = [
  { id: 'killPod', title: 'Kill a pod', detail: 'Delete a Ready pod. The ReplicaSet replaces it.', glyph: '✕', command: { type: 'killPod' } },
  {
    id: 'injectErrors',
    title: 'Inject 5xx errors',
    detail: '20% of requests fail for 30 s. Burns error budget fast.',
    glyph: '⚠',
    command: { type: 'injectErrors', ratio: 0.2, durationMs: 30_000 },
  },
  {
    id: 'trafficSurge',
    title: 'Traffic surge',
    detail: '×3 traffic for 60 s. Watch the autoscaler react.',
    glyph: '⇈',
    command: { type: 'trafficSurge', multiplier: 3, durationMs: 60_000 },
  },
  {
    id: 'injectLatency',
    title: 'Inject latency',
    detail: '+400 ms on every request for 45 s.',
    glyph: '◷',
    command: { type: 'injectLatency', ms: 400, durationMs: 45_000 },
  },
  {
    id: 'failoverDatabase',
    title: 'Fail over the database',
    detail: 'The primary goes down; the replica is promoted.',
    glyph: '⇄',
    command: { type: 'failoverDatabase' },
  },
];

export const KILL_COOLDOWN_MS = 3_000;

export type CardStatus = 'ready' | 'running' | 'cooldown' | 'disabled';

export interface CardState {
  id: ActionId;
  status: CardStatus;
  /** Share of the run or cooldown still to go (1 → 0). */
  remaining: number;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

export function chaosCards(state: Readonly<SimState>, lastKillAt: number | null): CardState[] {
  return ACTIONS.map(({ id }) => {
    if (id === 'killPod') {
      const since = lastKillAt === null ? Number.POSITIVE_INFINITY : state.t - lastKillAt;
      return since < KILL_COOLDOWN_MS
        ? { id, status: 'cooldown', remaining: clamp01(1 - since / KILL_COOLDOWN_MS) }
        : { id, status: 'ready', remaining: 0 };
    }
    const run = state.chaos.find((r) => r.kind === id && r.endsAt > state.t);
    if (run) return { id, status: 'running', remaining: clamp01((run.endsAt - state.t) / Math.max(run.endsAt - run.startedAt, 1)) };
    if (id === 'failoverDatabase' && (state.db.phase !== 'Healthy' || state.db.rejoinAt !== null)) {
      return { id, status: 'disabled', remaining: 0 };
    }
    return { id, status: 'ready', remaining: 0 };
  });
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type Tone = 'ok' | 'warn' | 'crit';

export function budgetRing(remaining: number): { pct: string; tone: Tone; fraction: number } {
  return {
    pct: `${Math.round(remaining * 100)}%`,
    tone: remaining >= 0.5 ? 'ok' : remaining >= 0.2 ? 'warn' : 'crit',
    fraction: clamp01(remaining),
  };
}

export const SLO_CAPTION = `SLO 99.9% · window ${SLO_WINDOW_LABEL}`;

const rate = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));

export function burnText(slo: Readonly<SimState['slo']>): string {
  return `${rate(slo.burnLong)}× (60 s) · ${rate(slo.burnShort)}× (5 s) · pages at ${BURN_RATE_PAGE}×`;
}

export function podsText(state: Readonly<SimState>): { text: string; hold: string | null } {
  const ready = state.pods.filter((p) => p.status === 'Ready').length;
  const hold = state.hpa.scaleDownHoldUntil;
  return {
    text: `${ready} ready / ${state.deployment.desiredReplicas} desired · HPA target ${Math.round(state.hpa.targetUtilization * 100)}%`,
    hold: hold === null ? null : `scale-down held ${formatClock(hold - state.t)} (300 s stabilization)`,
  };
}

export function dbText(state: Readonly<SimState>): string {
  const { db } = state;
  const roles = db.instances.map((i) => `${i.id} ${i.up ? i.role : 'down'}`).join(' · ');
  const phase = db.phase === 'Healthy' ? (db.rejoinAt !== null ? 'old primary rejoining' : 'healthy') : db.phase.toLowerCase();
  return `${roles}\n${phase} · lag ${Math.round(db.replicationLagMs)} ms · pool ${db.pool.active}/${db.pool.max}`;
}

/** Scales a series into a sparkline box; the floor is 0 so a spike reads as a spike. */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 2): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const max = Math.max(...values) * 1.15 || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({ x: pad + i * step, y: height - pad - (Math.max(v, 0) / max) * (height - pad * 2) }));
}

export function timelineRows(timeline: readonly TimelineEvent[], n: number): TimelineEvent[] {
  return timeline.slice(-n).reverse();
}

const CHAOS_TITLE: Record<ChaosKind, string> = {
  killPod: 'kill pod',
  injectErrors: '5xx errors',
  injectLatency: 'latency',
  trafficSurge: 'traffic surge',
  failoverDatabase: 'DB failover',
  drainNode: 'node drain',
};

export function postmortemRows(pm: Postmortem): [string, string][] {
  return [
    ['Chaos', pm.chaos.map((c) => CHAOS_TITLE[c]).join(', ')],
    ['Time to detect', pm.timeToDetectMs === null ? 'not paged (self-healed)' : formatClock(pm.timeToDetectMs)],
    ['Time to recover', formatClock(pm.timeToRecoverMs)],
    ['Error budget burned', `${(pm.budgetBurned * 100).toFixed(1)}%`],
    ['Peak error rate', `${(pm.peakErrorRatio * 100).toFixed(2)}%`],
    ['Peak p99', `${Math.round(pm.peakP99)} ms`],
    ['Alerts', pm.alertsFired.join(', ') || 'none'],
  ];
}
