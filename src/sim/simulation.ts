import { evaluateAlerts, initialAlerts } from './alerts.ts';
import { createBus, type Bus } from './bus.ts';
import { initialCluster, killPod, reconcileCluster } from './cluster.ts';
import {
  DB_PRIMARY_DOWN_MS,
  DB_PROMOTING_MS,
  DB_RECONNECTING_MS,
  MAX_CATCH_UP_MS,
  RPS_PER_POD_AT_FULL_REQUEST,
  TICK_MS,
  TIMELINE_LIMIT,
  WRITE_FRACTION,
} from './config.ts';
import { initialDatabase, reconcileDatabase, startFailover } from './database.ts';
import { initialHpa, reconcileHpa } from './hpa.ts';
import { initialIncident, trackIncident } from './incident.ts';
import { createRng, type Rng } from './rng.ts';
import { initialSlo, updateSlo } from './slo.ts';
import { initialMetrics, initialTraffic, recordMetrics, stepTraffic } from './traffic.ts';
import type { ChaosKind, ChaosRun, Command, MetricsPoint, SimEvent, SimState, Speed, TickContext, TimelineEvent } from './types.ts';

const CHAOS_LABEL: Record<ChaosKind, string> = {
  killPod: 'Kill pod',
  injectErrors: 'Error injection',
  injectLatency: 'Latency injection',
  trafficSurge: 'Traffic surge',
  failoverDatabase: 'Database failover',
  drainNode: 'Node drain',
};

const seconds = (ms: number) => `${Math.round(ms / 1_000)} s`;

interface Scheduled {
  at: number;
  seq: number;
  /** Reset generation the command belongs to; a queued reset starts a new one. */
  epoch: number;
  command: Command;
}

/**
 * The simulated platform. Time advances in fixed 100 ms ticks, so a run depends only on the
 * seed and the command schedule, never on frame rate. Each tick: apply due commands, run every
 * subsystem's reconcile pass in a fixed order, expire chaos, then publish the tick's events.
 */
export class Simulation {
  readonly bus: Bus<SimEvent> = createBus<SimEvent>();

  #state!: SimState;
  #rng!: Rng;
  #queue: Scheduled[] = [];
  #queueSeq = 0;
  /** Generation currently running, and the generation newly queued commands join. */
  #epoch = 0;
  #queuedEpoch = 0;
  #accumulator = 0;
  #speed: Speed = 1;
  #pending: SimEvent[] = [];

  constructor({ seed = 1 }: { seed?: number } = {}) {
    this.#init(seed);
  }

  get state(): Readonly<SimState> {
    return this.#state;
  }

  get speed(): Speed {
    return this.#speed;
  }

  /** Newest 1 s metrics point, or null in the first second. */
  get latest(): MetricsPoint | null {
    return this.#state.metrics.series.at(-1) ?? null;
  }

  /** Queue a command for the next tick. */
  dispatch(command: Command): void {
    // After a queued reset, "now" means the start of the new timeline.
    this.schedule(this.#queuedEpoch === this.#epoch ? this.#state.t : 0, command);
  }

  /** Queue a command for a sim time; it applies on the first tick at or after `atMs` (tours, deep links, tests). */
  schedule(atMs: number, command: Command): void {
    this.#queue.push({ at: atMs, seq: this.#queueSeq++, epoch: this.#queuedEpoch, command });
    this.#queue.sort((a, b) => a.epoch - b.epoch || a.at - b.at || a.seq - b.seq);
    // Commands queued after a reset belong to the timeline it starts.
    if (command.type === 'reset') this.#queuedEpoch++;
  }

  /** Advance by real elapsed time. Returns every event emitted during the ticks that ran. */
  advance(realDtMs: number): SimEvent[] {
    this.#accumulator += Math.min(Math.max(realDtMs, 0), MAX_CATCH_UP_MS) * this.#speed;
    const emitted: SimEvent[] = [];
    while (this.#accumulator >= TICK_MS) {
      this.#accumulator -= TICK_MS;
      emitted.push(...this.#tick());
    }
    return emitted;
  }

  #init(seed: number) {
    this.#rng = createRng(seed);
    this.#state = {
      t: 0,
      seed,
      ...initialCluster(this.#rng, 0),
      chaos: [],
      traffic: initialTraffic(),
      metrics: initialMetrics(),
      hpa: initialHpa(),
      slo: initialSlo(),
      alerts: initialAlerts(),
      db: initialDatabase(),
      incident: initialIncident(),
      lastPostmortem: null,
      timeline: [],
      counters: { pod: 0, chaos: 0, timeline: 0 },
    };
  }

  #tick(): SimEvent[] {
    const state = this.#state;
    state.t += TICK_MS;
    const ctx = this.#context();

    while (this.#queue.length > 0 && this.#queue[0]!.epoch === this.#epoch && this.#queue[0]!.at <= state.t) {
      const { command } = this.#queue.shift()!;
      this.#apply(command, ctx);
      if (command.type === 'reset') return this.#flush();
    }

    reconcileCluster(state, ctx);
    reconcileDatabase(state, ctx);
    const traffic = stepTraffic(state, ctx, this.#injectedErrorRatio(ctx.t));
    recordMetrics(state, ctx, traffic);
    updateSlo(state, traffic);
    evaluateAlerts(state, ctx);
    // The HPA reads the last full metrics point, like a metrics-server scrape, not a single tick.
    // Demand (in pods' worth of CPU request) from the last 1 s of traffic, split over the pods
    // Ready now, so utilization × readyPods is always the real load.
    const demand = (this.latest?.rps ?? traffic.rps) / RPS_PER_POD_AT_FULL_REQUEST;
    if (traffic.readyPods > 0) reconcileHpa(state, ctx, demand / traffic.readyPods, traffic.readyPods);
    trackIncident(state, ctx, traffic);
    this.#expireChaos(ctx);
    return this.#flush();
  }

  /** 5xx injection and failed writes during a DB failover, combined as independent failures. */
  #injectedErrorRatio(t: number): number {
    const injected = this.#state.chaos
      .filter((run) => run.kind === 'injectErrors' && run.endsAt > t)
      .reduce((ok, run) => ok * (1 - run.intensity), 1);
    return 1 - injected * (1 - WRITE_FRACTION * this.#state.db.writeFailureRatio);
  }

  #context(): TickContext {
    const state = this.#state;
    return {
      t: state.t,
      rng: this.#rng,
      emit: (event) => this.#pending.push(event),
      log: (source, severity, message) => {
        const entry: TimelineEvent = { seq: ++state.counters.timeline, t: state.t, source, severity, message };
        state.timeline.push(entry);
        if (state.timeline.length > TIMELINE_LIMIT) state.timeline.splice(0, state.timeline.length - TIMELINE_LIMIT);
        this.#pending.push({ type: 'timelineEvent', t: state.t, entry });
      },
      startChaos: (kind, { durationMs, intensity = 1, target }) => {
        const run: ChaosRun = {
          id: ++state.counters.chaos,
          kind,
          startedAt: state.t,
          endsAt: state.t + durationMs,
          intensity,
          ...(target === undefined ? {} : { target }),
        };
        state.chaos.push(run);
        this.#pending.push({ type: 'chaosStarted', t: state.t, run: { ...run } });
        return run;
      },
    };
  }

  #apply(command: Command, ctx: TickContext) {
    switch (command.type) {
      case 'killPod':
        killPod(this.#state, ctx, command.podId);
        return;
      case 'trafficSurge':
        ctx.startChaos('trafficSurge', { durationMs: command.durationMs, intensity: command.multiplier });
        ctx.log('chaos', 'warn', `Traffic surge ×${command.multiplier} for ${seconds(command.durationMs)}`);
        return;
      case 'injectLatency':
        ctx.startChaos('injectLatency', { durationMs: command.durationMs, intensity: command.ms });
        ctx.log('chaos', 'warn', `Injected +${command.ms} ms latency for ${seconds(command.durationMs)}`);
        return;
      case 'injectErrors':
        ctx.startChaos('injectErrors', { durationMs: command.durationMs, intensity: command.ratio });
        ctx.log('chaos', 'warn', `Injected ${+(command.ratio * 100).toFixed(1)}% HTTP 5xx for ${seconds(command.durationMs)}`);
        return;
      case 'failoverDatabase':
        if (startFailover(this.#state, ctx)) {
          ctx.startChaos('failoverDatabase', { durationMs: DB_PRIMARY_DOWN_MS + DB_PROMOTING_MS + DB_RECONNECTING_MS });
        }
        return;
      case 'recoverAll': {
        // A promoted replica can't be un-promoted: an in-flight failover runs to completion.
        const active = this.#state.chaos.filter((run) => run.endsAt > ctx.t);
        const stoppable = active.filter((run) => run.kind !== 'failoverDatabase');
        stoppable.forEach((run) => (run.endsAt = ctx.t));
        const failover = active.length > stoppable.length ? '; database failover cannot be undone, letting it complete' : '';
        ctx.log(
          'chaos',
          'info',
          stoppable.length > 0
            ? `Recover all: stopped ${stoppable.length} experiment(s)${failover}`
            : `Recover all: no active experiments${failover}`,
        );
        return;
      }
      case 'setSpeed':
        this.#speed = command.speed;
        ctx.emit({ type: 'speedChanged', t: ctx.t, speed: command.speed });
        return;
      case 'reset': {
        const seed = command.seed ?? this.#state.seed;
        // Drop what was queued before the reset; keep what was queued after it.
        this.#epoch++;
        this.#queue = this.#queue.filter((item) => item.epoch >= this.#epoch);
        this.#init(seed);
        this.#pending.push({ type: 'reset', t: 0, seed });
        this.#context().log('sim', 'info', `Scenario reset (seed ${seed})`);
        return;
      }
    }
  }

  /** Chaos runs end on their own schedule (or when recoverAll pulls endsAt forward). */
  #expireChaos(ctx: TickContext) {
    const state = this.#state;
    const ended = state.chaos.filter((run) => run.endsAt <= ctx.t);
    if (ended.length === 0) return;
    state.chaos = state.chaos.filter((run) => run.endsAt > ctx.t);
    ended.forEach((run) => {
      ctx.emit({ type: 'chaosEnded', t: ctx.t, run: { ...run } });
      if (run.endsAt > run.startedAt) ctx.log('chaos', 'info', `${CHAOS_LABEL[run.kind]} ended`);
    });
  }

  #flush(): SimEvent[] {
    const events = this.#pending;
    this.#pending = [];
    events.forEach((event) => this.bus.emit(event));
    return events;
  }
}
