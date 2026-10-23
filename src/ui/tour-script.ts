import {
  BASE_RPS,
  BURN_LONG_WINDOW_MS,
  BURN_RATE_PAGE,
  BURN_SHORT_WINDOW_MS,
  DEPLOYMENT_NAME,
  HPA_SCALE_DOWN_STABILIZATION_MS,
  INITIAL_REPLICAS,
  SLO_TARGET,
  ZONES,
} from '../sim/config.ts';
import type { Command, SimEvent, SimState } from '../sim/types.ts';
import { ACTIONS, type ActionId } from './view-models.ts';

// The guided tour as data: what each step points at, says, does, and waits for. No DOM here, so the
// whole script can be run against a real Simulation in tests.

export interface TourStep {
  id: string;
  /** data-tour id of the element the spotlight frames. */
  target: string;
  /** Where the spotlight moves once the step's condition is met. */
  doneTarget?: string;
  title: string;
  body: string;
  /** Commands run the first time the step is shown (never again on Back). */
  actions?: readonly Command[];
  /** The simulator event the step waits for after its actions. */
  waitFor?: (event: SimEvent, state: Readonly<SimState>) => boolean;
  /** Shown while waiting. */
  waiting?: string;
  /** Shown once the condition is met, from the event that met it. */
  done?: (event: SimEvent, state: Readonly<SimState>) => string;
  /** Move to the next step on its own once the condition is met. */
  autoAdvance?: boolean;
  /** Simulated time after which the step stops waiting and says so; Next works throughout. */
  timeoutMs?: number;
}

const command = (id: ActionId): Command => ({ ...ACTIONS.find((a) => a.id === id)!.command });
const secs = (ms: number) => Math.round(ms / 1_000);
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const errors = command('injectErrors');
const errorShare = errors.type === 'injectErrors' ? pct(errors.ratio) : '';
const errorFor = errors.type === 'injectErrors' ? secs(errors.durationMs) : 0;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'meet',
    target: 'cluster',
    title: `Meet ${DEPLOYMENT_NAME}`,
    body:
      `${INITIAL_REPLICAS} pods across ${ZONES.length} zones serve about ${BASE_RPS} requests a second, backed by a Postgres primary and replica. ` +
      `The promise to users is the SLO: ${pct(SLO_TARGET, 1)} of requests succeed. The tour starts a fresh scenario at 1× and runs each experiment for you.`,
    actions: [{ type: 'reset' }, { type: 'setSpeed', speed: 1 }],
  },
  {
    id: 'kill',
    target: 'action-killPod',
    doneTarget: 'postmortem',
    title: 'Break something small: kill a pod',
    body:
      'The tour just deleted a Ready pod, as kubectl delete pod would. The ReplicaSet creates a replacement, which takes traffic once its readiness probe passes. ' +
      'The other pods carry the load meanwhile, so the error budget barely moves and nobody is paged.',
    actions: [command('killPod')],
    waitFor: (e) => e.type === 'postmortemReady',
    waiting: 'Waiting for the replacement pod to pass its readiness probe…',
    done: (e) =>
      e.type === 'postmortemReady'
        ? `✓ Healed in ${secs(e.postmortem.timeToRecoverMs)} s. Postmortem: not paged (self-healed).`
        : '✓ Healed.',
    timeoutMs: 30_000,
  },
  {
    id: 'errors',
    target: 'slo',
    title: `Now a real problem: ${errorShare} of requests fail`,
    body:
      `The tour injected 5xx errors into ${errorShare} of requests for ${errorFor} s. Watch the error budget drain. ` +
      `The alert compares how fast it burns against a ${BURN_RATE_PAGE}× threshold on two windows at once.`,
    actions: [errors],
    waitFor: (e) => e.type === 'alertStateChanged' && e.name === 'HighErrorBudgetBurn' && e.to === 'firing',
    waiting: `Burning budget. The page fires once both windows stay above ${BURN_RATE_PAGE}×…`,
    done: () => '● HighErrorBudgetBurn is firing.',
    autoAdvance: true,
    timeoutMs: 30_000,
  },
  {
    id: 'page',
    target: 'alerts',
    title: 'Paged: HighErrorBudgetBurn',
    body:
      `Both burn rates passed ${BURN_RATE_PAGE}×. At that pace a 30-day error budget is gone in about two days. ` +
      `Requiring a long window (1 h in production, ${secs(BURN_LONG_WINDOW_MS)} s here) and a short one (5 min, ${secs(BURN_SHORT_WINDOW_MS)} s here) to agree is the SRE Workbook's multi-window rule: ` +
      'it pages fast on a real outage and goes quiet soon after recovery. "</> real config" on the error budget shows the PrometheusRule.',
  },
  {
    id: 'recover',
    target: 'recover',
    doneTarget: 'postmortem',
    title: 'Mitigate: recover all',
    body:
      'The tour pressed Recover all, the equivalent of rolling back a bad release. Errors stop, the short window clears first and the alert resolves. ' +
      'After a few healthy seconds the incident closes and the postmortem writes itself.',
    actions: [{ type: 'recoverAll' }],
    waitFor: (e) => e.type === 'postmortemReady',
    waiting: 'Waiting for the platform to stay healthy…',
    done: (e) => {
      if (e.type !== 'postmortemReady') return '✓ Recovered.';
      const pm = e.postmortem;
      const detected = pm.timeToDetectMs === null ? 'not paged' : `paged after ${secs(pm.timeToDetectMs)} s`;
      return `✓ ${detected}, recovered in ${secs(pm.timeToRecoverMs)} s, ${pct(pm.budgetBurned, 1)} of the error budget burned.`;
    },
    timeoutMs: 40_000,
  },
  {
    id: 'yours',
    target: 'actions',
    title: 'Your turn',
    body:
      `Try a traffic surge to watch the autoscaler add pods and hold them for ${secs(HPA_SCALE_DOWN_STABILIZATION_MS)} s before scaling down, ` +
      'add latency to see p99 climb, or fail over the database. Every "</> real config" button shows the production manifest a panel stands for, and 5× speeds things up.',
  },
];

export type StepProgress = { met: false; startedAt: number } | { met: true; text: string };

/** The status line under a step's body: waiting, done, or taking longer than expected. */
export function statusLine(step: TourStep, progress: StepProgress, now: number): string {
  if (!step.waitFor) return '';
  if (progress.met) return progress.text;
  if (step.timeoutMs !== undefined && now - progress.startedAt > step.timeoutMs) {
    return 'This is taking longer than usual. Continue whenever you like.';
  }
  return step.waiting ?? '';
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the step card goes: beside the target (right, left, below, above, in that order), or tucked
 * inside the bottom-left of a target too big to sit beside. Always inside the viewport.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 16,
  gap = 14,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - margin - card.width);
  const maxTop = Math.max(margin, viewport.height - margin - card.height);
  const clampLeft = (x: number) => Math.min(Math.max(x, margin), maxLeft);
  const clampTop = (y: number) => Math.min(Math.max(y, margin), maxTop);
  if (!target || target.width === 0 || target.height === 0) {
    return { left: clampLeft((viewport.width - card.width) / 2), top: maxTop };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const at = (left: number, top: number) => ({ left: clampLeft(left), top: clampTop(top) });
  if (right + gap + card.width <= viewport.width - margin) return at(right + gap, target.top);
  if (target.left - gap - card.width >= margin) return at(target.left - gap - card.width, target.top);
  if (bottom + gap + card.height <= viewport.height - margin) return at(target.left, bottom + gap);
  if (target.top - gap - card.height >= margin) return at(target.left, target.top - gap - card.height);
  return at(target.left + gap, Math.min(bottom, viewport.height) - gap - card.height);
}
