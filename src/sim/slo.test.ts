import { describe, expect, it } from 'vitest';
import { ERROR_BUDGET_REQUESTS } from './config.ts';
import { Simulation } from './simulation.ts';
import { burnRate } from './slo.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

describe('burnRate', () => {
  it('is the observed error ratio over the allowed one', () => {
    expect(burnRate(1_000, 1)).toBeCloseTo(1, 6);
    expect(burnRate(1_000, 50)).toBeCloseTo(50, 6);
    expect(burnRate(0, 0)).toBe(0);
  });
});

describe('SLO and error budget', () => {
  it('sizes the budget at 0.1% of an hour of 400 rps', () => {
    expect(ERROR_BUDGET_REQUESTS).toBeCloseTo(1_440, 6);
    const sim = new Simulation({ seed: 41 });
    expect(sim.state.slo.target).toBe(0.999);
    expect(sim.state.slo.windowMs).toBe(3_600_000);
  });

  it('spends ~28% of the budget during 20 s of 5% errors, burning ~50× on both windows', () => {
    const sim = new Simulation({ seed: 42 });
    run(sim, 60_000);
    const before = sim.state.slo.budgetRemaining;
    sim.dispatch({ type: 'injectErrors', ratio: 0.05, durationMs: 20_000 });
    run(sim, 20_000);

    const spent = before - sim.state.slo.budgetRemaining;
    expect(spent).toBeGreaterThan(0.23);
    expect(spent).toBeLessThan(0.33);
    expect(sim.state.slo.burnShort).toBeGreaterThan(40);
    expect(sim.state.slo.burnShort).toBeLessThan(60);
    expect(sim.state.slo.burnLong).toBeGreaterThan(14);
  });

  it('rolls spent budget off after the 1 h window', () => {
    const sim = new Simulation({ seed: 44 });
    sim.dispatch({ type: 'injectErrors', ratio: 0.5, durationMs: 20_000 });
    run(sim, 30_000);
    expect(sim.state.slo.budgetRemaining).toBeLessThan(0);
    run(sim, 3_600_000);
    expect(sim.state.slo.budgetRemaining).toBeGreaterThan(0.7);
    expect(sim.state.slo.errorSeconds.length).toBe(3_600);
  });

  it('lets the budget go negative once overspent', () => {
    const sim = new Simulation({ seed: 43 });
    sim.dispatch({ type: 'injectErrors', ratio: 0.5, durationMs: 60_000 });
    run(sim, 30_000);
    expect(sim.state.slo.budgetRemaining).toBeLessThan(0);
  });
});
