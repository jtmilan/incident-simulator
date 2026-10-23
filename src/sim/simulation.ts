import { createBus, type Bus } from './bus.ts';
import { initialCluster, killPod, reconcileCluster } from './cluster.ts';
import { MAX_CATCH_UP_MS, TICK_MS, TIMELINE_LIMIT } from './config.ts';
import { createRng, type Rng } from './rng.ts';
import type { ChaosRun, Command, SimEvent, SimState, Speed, TickContext, TimelineEvent } from './types.ts';

interface Scheduled {
  at: number;
  seq: number;
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

  /** Queue a command for the next tick. */
  dispatch(command: Command): void {
    this.schedule(this.#state.t, command);
  }

  /** Queue a command for a sim time; it applies on the first tick at or after `atMs` (tours, deep links, tests). */
  schedule(atMs: number, command: Command): void {
    this.#queue.push({ at: atMs, seq: this.#queueSeq++, command });
    this.#queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
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
      timeline: [],
      counters: { pod: 0, chaos: 0, timeline: 0 },
    };
  }

  #tick(): SimEvent[] {
    const state = this.#state;
    state.t += TICK_MS;
    const ctx = this.#context();

    while (this.#queue.length > 0 && this.#queue[0]!.at <= state.t) {
      const { command } = this.#queue.shift()!;
      this.#apply(command, ctx);
      if (command.type === 'reset') return this.#flush();
    }

    reconcileCluster(state, ctx);
    this.#expireChaos(ctx);
    return this.#flush();
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
      case 'recoverAll': {
        const active = this.#state.chaos.filter((run) => run.endsAt > ctx.t);
        active.forEach((run) => (run.endsAt = ctx.t));
        ctx.log(
          'chaos',
          'info',
          active.length > 0 ? `Recover all: stopped ${active.length} experiment(s)` : 'Recover all: no active experiments',
        );
        return;
      }
      case 'setSpeed':
        this.#speed = command.speed;
        ctx.emit({ type: 'speedChanged', t: ctx.t, speed: command.speed });
        return;
      case 'reset': {
        const seed = command.seed ?? this.#state.seed;
        this.#queue = [];
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
    ended.forEach((run) => ctx.emit({ type: 'chaosEnded', t: ctx.t, run: { ...run } }));
  }

  #flush(): SimEvent[] {
    const events = this.#pending;
    this.#pending = [];
    events.forEach((event) => this.bus.emit(event));
    return events;
  }
}
