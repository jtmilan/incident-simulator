import { describe, expect, it } from 'vitest';
import { K8S_NAME_ALPHABET, TICK_MS } from './config.ts';
import { initialCluster, killPod, reconcileCluster } from './cluster.ts';
import { initialHpa } from './hpa.ts';
import { createRng, type Rng } from './rng.ts';
import { initialMetrics, initialTraffic } from './traffic.ts';
import type { ChaosRun, SimEvent, SimState, TickContext, TimelineEvent } from './types.ts';

// A bare-bones tick loop so the reconciler can be tested without the Simulation class.
function harness(seed: number) {
  const rng: Rng = createRng(seed);
  const state: SimState = {
    t: 0,
    seed,
    ...initialCluster(rng, 0),
    chaos: [],
    traffic: initialTraffic(),
    metrics: initialMetrics(),
    hpa: initialHpa(),
    timeline: [],
    counters: { pod: 0, chaos: 0, timeline: 0 },
  };
  const events: SimEvent[] = [];
  const timeline: TimelineEvent[] = [];
  const ctx = (): TickContext => ({
    t: state.t,
    rng,
    emit: (e) => events.push(e),
    log: (source, severity, message) => timeline.push({ seq: timeline.length, t: state.t, source, severity, message }),
    startChaos: (kind, { durationMs, target }) => {
      const run: ChaosRun = { id: ++state.counters.chaos, kind, startedAt: state.t, endsAt: state.t + durationMs, intensity: 1, target };
      state.chaos.push(run);
      return run;
    },
  });
  const run = (ms: number) => {
    for (let i = 0; i < ms / TICK_MS; i++) {
      state.t += TICK_MS;
      reconcileCluster(state, ctx());
    }
  };
  return { state, events, timeline, ctx, run };
}

const NAME = new RegExp(`^checkout-api-[${K8S_NAME_ALPHABET}]{10}-[${K8S_NAME_ALPHABET}]{5}$`);

describe('initial cluster', () => {
  it('starts healthy: 3 zonal nodes, 3 Ready pods one per zone, kubernetes-style names', () => {
    const h = harness(42);
    h.run(30_000);

    expect(h.state.nodes.map((n) => [n.zone, n.capacityPods, n.ready])).toEqual([
      ['a', 4, true],
      ['b', 4, true],
      ['c', 4, true],
    ]);
    expect(h.state.pods).toHaveLength(3);
    expect(h.state.pods.every((p) => p.status === 'Ready')).toBe(true);
    expect(new Set(h.state.pods.map((p) => p.nodeId))).toEqual(new Set(['node-a', 'node-b', 'node-c']));
    h.state.pods.forEach((p) => expect(p.id).toMatch(NAME));
    expect(h.events).toEqual([]);
  });
});

describe('killPod', () => {
  it('replaces a killed pod and the replacement is Ready 5–10 s later, for every seed', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const h = harness(seed);
      h.run(1_000);
      const victim = h.state.pods[0]!;
      const killedAt = h.state.t;

      expect(killPod(h.state, h.ctx(), victim.id)).toBe(victim);
      expect(victim.status).toBe('Terminating');

      reconcileCluster(h.state, h.ctx()); // the ReplicaSet reacts in the same tick
      const replacement = h.state.pods.find((p) => p.status === 'Pending');
      expect(replacement).toBeDefined();

      h.run(12_000);
      expect(h.state.pods.find((p) => p.id === victim.id)).toBeUndefined();
      const readyIn = replacement!.readyAt! - killedAt;
      expect(readyIn, `seed ${seed}`).toBeGreaterThanOrEqual(5_000);
      expect(readyIn, `seed ${seed}`).toBeLessThanOrEqual(10_000);
      expect(h.state.pods.filter((p) => p.status === 'Ready')).toHaveLength(3);
    }
  });

  it('walks the replacement through every phase and lands it in the emptied zone', () => {
    const h = harness(3);
    h.run(1_000);
    const victim = h.state.pods.find((p) => p.nodeId === 'node-b')!;
    killPod(h.state, h.ctx(), victim.id);
    h.run(12_000);

    const replacement = h.state.pods.find((p) => p.id !== victim.id && p.createdAt > 0)!;
    expect(replacement.nodeId).toBe('node-b');
    const path = h.events
      .filter((e) => e.type === 'podPhaseChanged' && e.podId === replacement.id)
      .map((e) => (e.type === 'podPhaseChanged' ? e.to : ''));
    expect(path).toEqual(['ContainerCreating', 'Running', 'Ready']);
    expect(h.events.some((e) => e.type === 'podDeleted' && e.podId === victim.id)).toBe(true);
    expect(h.timeline.map((e) => e.source)).toContain('chaos');
  });

  it('removes the old pod after a short graceful termination', () => {
    const h = harness(9);
    h.run(500);
    const victim = h.state.pods[1]!;
    killPod(h.state, h.ctx(), victim.id);
    h.run(400);
    expect(h.state.pods).toContain(victim);
    h.run(800);
    expect(h.state.pods).not.toContain(victim);
  });

  it('chooses the same Ready victim for the same seed when no pod is named', () => {
    const a = harness(11);
    const b = harness(11);
    a.run(1_000);
    b.run(1_000);
    expect(killPod(a.state, a.ctx())?.id).toBe(killPod(b.state, b.ctx())?.id);
  });

  it('is a no-op for an unknown or already-terminating pod', () => {
    const h = harness(5);
    h.run(1_000);
    expect(killPod(h.state, h.ctx(), 'checkout-api-nope')).toBeNull();
    const victim = h.state.pods[0]!;
    killPod(h.state, h.ctx(), victim.id);
    const logged = h.timeline.length;
    expect(killPod(h.state, h.ctx(), victim.id)).toBeNull();
    expect(h.timeline).toHaveLength(logged);
  });

  it('falls back to any live pod when none is Ready, and returns null when nothing is alive', () => {
    const h = harness(6);
    h.state.pods.forEach((p) => (p.status = 'Running'));
    expect(killPod(h.state, h.ctx())).not.toBeNull();
    h.state.pods.forEach((p) => (p.status = 'Terminating'));
    expect(killPod(h.state, h.ctx())).toBeNull();
  });
});

describe('ReplicaSet reconcile', () => {
  it('reports FailedScheduling once when the cluster is out of pod capacity', () => {
    const h = harness(8);
    h.state.deployment.desiredReplicas = 13; // 3 nodes × 4 pods = 12
    h.run(20_000);

    expect(h.state.pods.filter((p) => p.status === 'Ready')).toHaveLength(12);
    const stuck = h.state.pods.filter((p) => p.status === 'Pending');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.schedulingFailed).toBe(true);
    expect(h.timeline.filter((e) => e.message.startsWith('FailedScheduling'))).toHaveLength(1);

    h.state.deployment.desiredReplicas = 12; // capacity frees up: the stuck pod is the one removed
    h.run(2_000);
    expect(h.state.pods.filter((p) => p.status !== 'Terminating')).toHaveLength(12);
  });

  it('schedules a pod that waited for capacity as soon as a slot frees up', () => {
    const h = harness(12);
    h.state.deployment.desiredReplicas = 13;
    h.run(20_000);
    const stuck = h.state.pods.find((p) => p.status === 'Pending')!;
    killPod(h.state, h.ctx(), h.state.pods.find((p) => p.status === 'Ready')!.id);
    h.run(12_000);
    // The waiting pod takes the freed slot; the ReplicaSet's new replacement is now the one waiting.
    expect(stuck.nodeId).not.toBeNull();
    expect(stuck.status).toBe('Ready');
    expect(h.state.pods.filter((p) => p.status === 'Ready')).toHaveLength(12);
  });

  it('scales down by removing the least-progressed, newest pods first', () => {
    const h = harness(4);
    h.state.deployment.desiredReplicas = 5;
    h.run(1_000); // two new pods still starting
    const fresh = h.state.pods.filter((p) => p.createdAt > 0).map((p) => p.id);
    h.state.deployment.desiredReplicas = 3;
    h.run(2_000);
    expect(h.state.pods.map((p) => p.id)).not.toEqual(expect.arrayContaining(fresh));
    expect(h.state.pods).toHaveLength(3);
  });
});
