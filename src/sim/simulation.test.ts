import { describe, expect, it, vi } from 'vitest';
import { TIMELINE_LIMIT } from './config.ts';
import { Simulation } from './simulation.ts';
import type { SimEvent, SimState } from './types.ts';

function runInChunks(sim: Simulation, totalMs: number, chunkMs: number) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += chunkMs) sim.advance(chunkMs);
}

const fingerprint = (sim: Simulation) => ({
  timeline: sim.state.timeline.map((e) => `${e.t}|${e.source}|${e.message}`),
  pods: sim.state.pods.map((p) => `${p.id}|${p.status}|${p.nodeId}`),
});

describe('Simulation', () => {
  it('is deterministic for a seed and a command schedule, whatever the frame size', () => {
    const make = () => {
      const sim = new Simulation({ seed: 42 });
      sim.schedule(10_000, { type: 'killPod' });
      sim.schedule(40_000, { type: 'killPod' });
      sim.schedule(41_000, { type: 'killPod' });
      return sim;
    };
    const smooth = make();
    const choppy = make();
    const smoothEvents: string[] = [];
    smooth.bus.onAny((e) => smoothEvents.push(e.type));
    const choppyEvents: string[] = [];
    choppy.bus.onAny((e) => choppyEvents.push(e.type));

    runInChunks(smooth, 120_000, 16);
    runInChunks(choppy, 120_000, 250);

    expect(smooth.state.t).toBe(120_000);
    expect(fingerprint(smooth)).toEqual(fingerprint(choppy));
    expect(smoothEvents).toEqual(choppyEvents);
    expect(smoothEvents.filter((t) => t === 'chaosStarted')).toHaveLength(3);
  });

  it('applies a dispatched command on the next 100 ms tick boundary', () => {
    const sim = new Simulation({ seed: 1 });
    sim.advance(50);
    sim.dispatch({ type: 'killPod' });
    expect(sim.state.pods.every((p) => p.status === 'Ready')).toBe(true);

    const events = sim.advance(50);
    expect(sim.state.t).toBe(100);
    expect(events.some((e) => e.type === 'podPhaseChanged' && e.to === 'Terminating')).toBe(true);
  });

  it('caps catch-up after a long pause, scaled by speed', () => {
    const sim = new Simulation({ seed: 1 });
    sim.advance(10_000);
    expect(sim.state.t).toBe(1_000);

    sim.dispatch({ type: 'setSpeed', speed: 5 });
    sim.advance(100);
    expect(sim.speed).toBe(5);
    const before = sim.state.t;
    sim.advance(10_000);
    expect(sim.state.t - before).toBe(5_000);
    expect(sim.advance(-50)).toEqual([]);
  });

  it('publishes events on the bus after each tick and returns them from advance()', () => {
    const sim = new Simulation({ seed: 2 });
    const onBus = vi.fn<(e: SimEvent) => void>();
    sim.bus.on('podPhaseChanged', onBus);
    sim.dispatch({ type: 'killPod' });
    const returned = sim.advance(15_000);

    const changes = returned.filter((e) => e.type === 'podPhaseChanged');
    expect(onBus).toHaveBeenCalledTimes(changes.length);
    expect(returned.some((e) => e.type === 'timelineEvent' && e.entry.source === 'chaos')).toBe(true);
    expect(returned.map((e) => e.type)).toEqual(expect.arrayContaining(['chaosStarted', 'chaosEnded', 'podCreated', 'podDeleted']));
  });

  it('recoverAll stops active chaos without teleporting pods to Ready', () => {
    const sim = new Simulation({ seed: 3 });
    sim.dispatch({ type: 'killPod' });
    sim.advance(1_000);
    const internal = sim.state as SimState;
    internal.chaos.push({ id: 99, kind: 'injectErrors', startedAt: internal.t, endsAt: internal.t + 60_000, intensity: 0.05 });

    sim.dispatch({ type: 'recoverAll' });
    const events = sim.advance(100);

    expect(events.some((e) => e.type === 'chaosEnded' && e.run.id === 99)).toBe(true);
    expect(sim.state.chaos).toEqual([]);
    expect(sim.state.timeline.map((e) => e.message)).toContain('Recover all: stopped 1 experiment(s)');
    expect(sim.state.pods.some((p) => p.status !== 'Ready' && p.status !== 'Terminating')).toBe(true);

    sim.dispatch({ type: 'recoverAll' });
    sim.advance(100);
    expect(sim.state.timeline.map((e) => e.message)).toContain('Recover all: no active experiments');
  });

  it('reset rebuilds the initial cluster, clears the queue and emits reset', () => {
    const sim = new Simulation({ seed: 4 });
    const initialIds = sim.state.pods.map((p) => p.id);
    sim.dispatch({ type: 'killPod' });
    sim.schedule(30_000, { type: 'killPod' });
    sim.advance(1_000);

    sim.dispatch({ type: 'reset' });
    const events = sim.advance(100);
    expect(events.some((e) => e.type === 'reset' && e.seed === 4)).toBe(true);
    expect(sim.state.t).toBe(0);
    expect(sim.state.pods.map((p) => p.id)).toEqual(initialIds);
    expect(sim.state.timeline.map((e) => e.message)).toEqual(['Scenario reset (seed 4)']);

    sim.advance(1_000);
    sim.advance(1_000);
    sim.advance(1_000);
    expect(sim.state.chaos).toEqual([]);
    expect(sim.state.timeline.some((e) => e.source === 'chaos')).toBe(false);

    sim.dispatch({ type: 'reset', seed: 7 });
    sim.advance(100);
    expect(sim.state.seed).toBe(7);
  });

  it('keeps only the newest timeline entries', () => {
    const sim = new Simulation({ seed: 5 });
    for (let i = 0; i < 60; i++) {
      sim.dispatch({ type: 'killPod' });
      sim.advance(1_000);
      sim.advance(1_000);
    }
    expect(sim.state.timeline.length).toBe(TIMELINE_LIMIT);
    const seqs = sim.state.timeline.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBeGreaterThan(1);
  });
});
