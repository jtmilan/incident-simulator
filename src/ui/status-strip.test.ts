import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation.ts';
import { systemStatus } from './status-strip.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

describe('systemStatus', () => {
  it('reads OK on a healthy platform', () => {
    const sim = new Simulation({ seed: 81 });
    run(sim, 5_000);
    expect(systemStatus(sim.state, sim.latest)).toEqual({
      level: 'ok',
      label: 'OK',
      text: 'SLO 99.9% · budget 100% · all systems normal',
    });
  });

  it('reads DEGRADED while errors are elevated but nothing pages yet', () => {
    const sim = new Simulation({ seed: 82 });
    run(sim, 60_000);
    sim.dispatch({ type: 'injectErrors', ratio: 0.05, durationMs: 60_000 });
    run(sim, 5_000);
    expect(systemStatus(sim.state, sim.latest).level).toBe('degraded');
  });

  it('reads PAGING and names the alert once a page fires', () => {
    const sim = new Simulation({ seed: 83 });
    run(sim, 60_000);
    sim.dispatch({ type: 'injectErrors', ratio: 0.2, durationMs: 60_000 });
    run(sim, 15_000);
    const status = systemStatus(sim.state, sim.latest);
    expect(status.level).toBe('paging');
    expect(status.label).toBe('PAGING');
    expect(status.text).toMatch(/^SLO 99\.9% · budget \d+% · HighErrorBudgetBurn$/);
  });

  it('counts a slow tail as degraded even without errors', () => {
    const sim = new Simulation({ seed: 84 });
    run(sim, 5_000);
    sim.dispatch({ type: 'injectLatency', ms: 400, durationMs: 30_000 });
    run(sim, 5_000);
    expect(systemStatus(sim.state, sim.latest).level).toBe('degraded');
  });
});
