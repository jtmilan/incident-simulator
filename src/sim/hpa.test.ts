import { describe, expect, it } from 'vitest';
import { initialHpa, recommend, scaleUpLimit } from './hpa.ts';
import { Simulation } from './simulation.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

describe('recommend', () => {
  const hpa = initialHpa();

  it('applies desired = ceil(ready × utilization / target)', () => {
    expect(recommend(hpa, 3, 3, 1.35)).toBe(7);
    expect(recommend(hpa, 7, 7, 0.19)).toBe(3);
  });

  it('holds steady inside the ±10% tolerance band', () => {
    expect(recommend(hpa, 7, 7, 0.63)).toBe(7);
    expect(recommend(hpa, 7, 7, 0.55)).toBe(7);
  });

  it('clamps to min and max replicas', () => {
    expect(recommend(hpa, 3, 3, 0.05)).toBe(3);
    expect(recommend(hpa, 7, 7, 3)).toBe(10);
  });
});

describe('scaleUpLimit (default policy: max of +100% and +4 pods per period)', () => {
  it('lets small deployments add 4 and large ones double', () => {
    expect(scaleUpLimit(3)).toBe(7);
    expect(scaleUpLimit(5)).toBe(10);
  });
});

describe('HPA in the simulation', () => {
  it('scales 3 → 7 on a ×3 surge at the next sync, then settles inside tolerance', () => {
    const sim = new Simulation({ seed: 31 });
    const scaled: [number, number, number][] = [];
    sim.bus.on('scaled', (e) => scaled.push([e.t, e.from, e.to]));

    run(sim, 16_000);
    sim.dispatch({ type: 'trafficSurge', multiplier: 3, durationMs: 120_000 });
    run(sim, 60_000);

    expect(scaled[0]).toEqual([30_000, 3, 7]);
    expect(scaled).toHaveLength(1);
    const settled = sim.state.metrics.series.filter((p) => p.t > 55_000 && p.t <= 76_000);
    settled.forEach((p) => {
      expect(p.readyPods).toBe(7);
      expect(p.cpu).toBeGreaterThan(0.5);
      expect(p.cpu).toBeLessThan(0.65);
    });
    expect(sim.state.timeline.some((e) => e.source === 'hpa' && /New size: 7 \(was 3\).*above target/.test(e.message))).toBe(true);
  });

  it('holds the scale-down for the 300 s stabilization window, exposing a countdown', () => {
    const sim = new Simulation({ seed: 32 });
    const scaled: [number, number, number][] = [];
    sim.bus.on('scaled', (e) => scaled.push([e.t, e.from, e.to]));

    run(sim, 16_000);
    sim.dispatch({ type: 'trafficSurge', multiplier: 3, durationMs: 120_000 }); // ends at 136 s
    run(sim, 150_000); // t = 166 s
    expect(sim.state.deployment.desiredReplicas).toBe(7);
    const hold = sim.state.hpa.scaleDownHoldUntil;
    expect(hold).toBe(135_000 + 300_000);

    run(sim, 300_000); // t = 466 s
    const down = scaled.find(([, from, to]) => from === 7 && to === 3);
    expect(down).toBeDefined();
    expect(down![0]).toBeGreaterThanOrEqual(hold!);
    expect(down![0]).toBeLessThanOrEqual(hold! + 15_000);
    expect(sim.state.hpa.scaleDownHoldUntil).toBeNull();
    expect(sim.state.timeline.some((e) => /New size: 3 \(was 7\).*below target/.test(e.message))).toBe(true);
  });

  it('never exceeds max replicas, even under a ×6 surge', () => {
    const sim = new Simulation({ seed: 33 });
    run(sim, 16_000);
    sim.dispatch({ type: 'trafficSurge', multiplier: 6, durationMs: 120_000 });
    run(sim, 90_000);
    expect(sim.state.deployment.desiredReplicas).toBe(10);
  });
});
