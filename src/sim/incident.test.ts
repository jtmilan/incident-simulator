import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.ts';
import type { Postmortem } from './types.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

function capture(sim: Simulation) {
  const postmortems: Postmortem[] = [];
  let opened = 0;
  sim.bus.on('postmortemReady', (e) => postmortems.push(e.postmortem));
  sim.bus.on('incidentOpened', () => opened++);
  return { postmortems, opened: () => opened };
}

describe('incidents and postmortems', () => {
  it('a self-healing pod kill closes without paging', () => {
    const sim = new Simulation({ seed: 71 });
    const { postmortems, opened } = capture(sim);
    run(sim, 10_000);
    sim.dispatch({ type: 'killPod' });
    run(sim, 30_000);

    expect(opened()).toBe(1);
    expect(postmortems).toHaveLength(1);
    const pm = postmortems[0]!;
    expect(pm.timeToDetectMs).toBeNull();
    expect(pm.chaos).toEqual(['killPod']);
    expect(pm.alertsFired).toEqual([]);
    expect(pm.timeToRecoverMs).toBeGreaterThan(5_000);
    expect(pm.timeToRecoverMs).toBeLessThan(11_000);
    expect(sim.state.timeline.at(-1)?.message).toMatch(/Incident resolved in \d+ s, not paged \(self-healed\)\. Postmortem ready\./);
  });

  it('an error burst records time to detect, budget burned and peaks', () => {
    const sim = new Simulation({ seed: 72 });
    const { postmortems } = capture(sim);
    run(sim, 60_000);
    sim.dispatch({ type: 'injectErrors', ratio: 0.05, durationMs: 30_000 });
    run(sim, 60_000);

    expect(postmortems).toHaveLength(1);
    const pm = postmortems[0]!;
    expect(pm.timeToDetectMs).toBeGreaterThan(20_000);
    expect(pm.timeToDetectMs).toBeLessThan(24_000);
    expect(pm.timeToRecoverMs).toBeGreaterThanOrEqual(30_000);
    expect(pm.budgetBurned).toBeGreaterThan(0.35);
    expect(pm.budgetBurned).toBeLessThan(0.5);
    expect(pm.peakErrorRatio).toBeGreaterThan(0.045);
    expect(pm.alertsFired).toEqual(['HighErrorBudgetBurn']);
    expect(sim.state.lastPostmortem).toEqual(pm);
  });

  it('a database failover postmortem lists both pages', () => {
    const sim = new Simulation({ seed: 73 });
    const { postmortems } = capture(sim);
    run(sim, 60_000);
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 60_000);

    const pm = postmortems[0]!;
    expect(pm.chaos).toEqual(['failoverDatabase']);
    expect(pm.alertsFired).toEqual(expect.arrayContaining(['DBPrimaryDown', 'HighErrorBudgetBurn']));
    expect(pm.timeToDetectMs).toBe(3_000);
    expect(pm.timeToRecoverMs).toBeGreaterThanOrEqual(30_000);
  });

  it('stays closed while nothing happens', () => {
    const sim = new Simulation({ seed: 74 });
    const { postmortems, opened } = capture(sim);
    run(sim, 120_000);
    expect(opened()).toBe(0);
    expect(postmortems).toEqual([]);
  });
});
