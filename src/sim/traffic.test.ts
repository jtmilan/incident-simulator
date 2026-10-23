import { describe, expect, it } from 'vitest';
import { METRICS_HISTORY } from './config.ts';
import { Simulation } from './simulation.ts';
import type { MetricsPoint, SimState } from './types.ts';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const window = (sim: Simulation, fromMs: number, toMs: number): MetricsPoint[] =>
  sim.state.metrics.series.filter((p) => p.t > fromMs && p.t <= toMs);

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

describe('traffic model: steady state', () => {
  it('carries ~400 rps at ~45% CPU with baseline latency and almost no errors', () => {
    const sim = new Simulation({ seed: 21 });
    run(sim, 300_000);
    const points = window(sim, 0, 300_000);

    expect(mean(points.map((p) => p.rps))).toBeGreaterThan(360);
    expect(mean(points.map((p) => p.rps))).toBeLessThan(440);
    expect(mean(points.map((p) => p.cpu))).toBeGreaterThan(0.4);
    expect(mean(points.map((p) => p.cpu))).toBeLessThan(0.5);
    expect(mean(points.map((p) => p.p50))).toBeCloseTo(40, -1);
    expect(mean(points.map((p) => p.p95))).toBeGreaterThan(76);
    expect(mean(points.map((p) => p.p95))).toBeLessThan(104);
    expect(mean(points.map((p) => p.p99))).toBeGreaterThan(119);
    expect(mean(points.map((p) => p.p99))).toBeLessThan(161);
    expect(Math.max(...points.map((p) => p.errorRatio))).toBeLessThan(0.0005);
    expect(sim.state.deployment.desiredReplicas).toBe(3);
  });

  it('publishes one point per simulated second and keeps the last 5 minutes', () => {
    const sim = new Simulation({ seed: 22 });
    let ticks = 0;
    sim.bus.on('metricsTick', () => ticks++);
    run(sim, 400_000);

    expect(ticks).toBe(400);
    expect(sim.state.metrics.series).toHaveLength(METRICS_HISTORY);
    const ts = sim.state.metrics.series.map((p) => p.t);
    expect(ts.every((t, i) => i === 0 || t - ts[i - 1]! === 1_000)).toBe(true);
    expect(sim.latest?.t).toBe(400_000);
  });

  it('fails every request when no pod is Ready', () => {
    const sim = new Simulation({ seed: 23 });
    (sim.state as SimState).pods.forEach((p) => (p.status = 'Running'));
    sim.advance(1_000);
    expect(sim.latest?.errorRatio).toBe(1);
    expect(sim.latest?.p99).toBeCloseTo(1_000, 6);
  });
});

describe('traffic model: chaos', () => {
  it('ramps a surge in over a few seconds instead of jumping', () => {
    const sim = new Simulation({ seed: 24 });
    run(sim, 10_000);
    sim.dispatch({ type: 'trafficSurge', multiplier: 3, durationMs: 60_000 });
    sim.advance(1_000);
    expect(sim.latest!.rps).toBeLessThan(800);
    run(sim, 5_000);
    expect(sim.latest!.rps).toBeGreaterThan(1_000);
  });

  it('adds injected latency to every percentile without timeouts below the 1 s client timeout', () => {
    const sim = new Simulation({ seed: 25 });
    run(sim, 10_000);
    sim.dispatch({ type: 'injectLatency', ms: 400, durationMs: 45_000 });
    run(sim, 20_000);
    const during = window(sim, 15_000, 30_000);
    expect(mean(during.map((p) => p.p50))).toBeGreaterThan(420);
    expect(mean(during.map((p) => p.p99))).toBeGreaterThan(520);
    expect(Math.max(...during.map((p) => p.errorRatio))).toBeLessThan(0.005);

    run(sim, 35_000); // run ended at 55 s
    expect(sim.latest!.p99).toBeLessThan(170);
    expect(sim.state.timeline.map((e) => e.message)).toContain('Latency injection ended');
  });

  it('turns latency past the client timeout into errors', () => {
    const sim = new Simulation({ seed: 26 });
    run(sim, 5_000);
    sim.dispatch({ type: 'injectLatency', ms: 900, durationMs: 30_000 });
    run(sim, 15_000);
    expect(mean(window(sim, 8_000, 20_000).map((p) => p.errorRatio))).toBeGreaterThan(0.05);
  });

  it('degrades latency under a surge before the autoscaler catches up', () => {
    const sim = new Simulation({ seed: 27 });
    run(sim, 16_000);
    sim.dispatch({ type: 'trafficSurge', multiplier: 3, durationMs: 120_000 });
    run(sim, 12_000); // before the 30 s HPA sync
    expect(sim.latest!.cpu).toBeGreaterThan(1);
    expect(sim.latest!.p99).toBeGreaterThan(300);
  });
});
