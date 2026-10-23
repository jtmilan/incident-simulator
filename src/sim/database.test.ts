import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.ts';

function run(sim: Simulation, ms: number, step = 1_000) {
  for (let i = 0; i < ms / step; i++) sim.advance(step);
}

describe('database failover', () => {
  it('runs PrimaryDown → Promoting → Reconnecting → Healthy with the researched durations', () => {
    const sim = new Simulation({ seed: 61 });
    const phases: [number, string, string][] = [];
    sim.bus.on('dbStateChanged', (e) => phases.push([e.t, e.to, e.primary]));
    run(sim, 30_000);
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 40_000);

    const start = 30_100;
    expect(phases).toEqual([
      [start, 'PrimaryDown', 'db-1'],
      [start + 8_000, 'Promoting', 'db-1'],
      [start + 18_000, 'Reconnecting', 'db-2'],
      [start + 24_000, 'Healthy', 'db-2'],
    ]);
    expect(sim.state.db.instances).toEqual([
      { id: 'db-1', zone: 'a', role: 'replica', up: true },
      { id: 'db-2', zone: 'b', role: 'primary', up: true },
    ]);
    const messages = sim.state.timeline.filter((e) => e.source === 'db').map((e) => e.message);
    expect(messages).toEqual([
      'db-1 (primary) unreachable: readiness probe failing',
      'Failing over: promoting db-2 (failoverDelay: 0)',
      'db-2 promoted to primary; clients reconnecting',
      'Connection pool reconnected; writes healthy',
      'db-1 rejoined as replica (pg_rewind)',
    ]);
  });

  it('fails writes (20% of traffic) while reads keep working, then recovers', () => {
    const sim = new Simulation({ seed: 62 });
    run(sim, 30_000);
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 10_000);
    expect(sim.latest!.errorRatio).toBeGreaterThan(0.19);
    expect(sim.latest!.errorRatio).toBeLessThan(0.22);
    expect(sim.state.db.pool.active).toBe(0);

    run(sim, 21_000); // reconnecting is half done at ~21 s
    expect(sim.latest!.errorRatio).toBeLessThan(0.15);
    run(sim, 10_000);
    expect(sim.latest!.errorRatio).toBeLessThan(0.001);
    expect(sim.state.db.pool.active).toBeGreaterThan(0);
  });

  it('pages: DBPrimaryDown after 3 s and HighErrorBudgetBurn on the write failures', () => {
    const sim = new Simulation({ seed: 63 });
    const fired: Record<string, number> = {};
    sim.bus.on('alertStateChanged', (e) => e.to === 'firing' && (fired[e.name] ??= e.t));
    run(sim, 60_000);
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 40_000);

    const start = 60_100;
    expect(fired.DBPrimaryDown! - start).toBe(3_000);
    expect(fired.HighErrorBudgetBurn! - start).toBeGreaterThan(7_000);
    expect(fired.HighErrorBudgetBurn! - start).toBeLessThan(11_000);
    expect(sim.state.alerts.every((a) => a.state === 'inactive')).toBe(true);
  });

  it('spikes replication lag when the old primary rejoins, then settles below 50 ms', () => {
    const sim = new Simulation({ seed: 64 });
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 30_500, 100);
    expect(sim.state.db.replicationLagMs).toBeGreaterThan(1_000);
    run(sim, 8_000);
    expect(sim.state.db.replicationLagMs).toBeLessThan(50);
  });

  it('ignores a second failover mid-flight, and recoverAll does not abort one', () => {
    const sim = new Simulation({ seed: 65 });
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 2_000);
    sim.dispatch({ type: 'failoverDatabase' });
    sim.dispatch({ type: 'recoverAll' });
    run(sim, 2_000);

    const messages = sim.state.timeline.map((e) => e.message);
    expect(messages).toContain('Failover already in progress; ignoring');
    expect(messages).toContain('Recover all: no active experiments; database failover cannot be undone, letting it complete');
    expect(sim.state.db.phase).toBe('PrimaryDown');
    expect(sim.state.chaos.map((r) => r.kind)).toEqual(['failoverDatabase']);
    run(sim, 30_000);
    expect(sim.state.db.phase).toBe('Healthy');
    expect(sim.state.chaos).toEqual([]);
  });
});
