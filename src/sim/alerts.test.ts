import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.ts';
import type { SimState } from './types.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

function burnScenario(seed: number, ratio: number, durationMs: number, observeMs: number) {
  const sim = new Simulation({ seed });
  const transitions: { t: number; to: string }[] = [];
  sim.bus.on('alertStateChanged', (e) => e.name === 'HighErrorBudgetBurn' && transitions.push({ t: e.t, to: e.to }));
  run(sim, 60_000);
  sim.dispatch({ type: 'injectErrors', ratio, durationMs });
  const start = 60_100; // applied on the next tick
  run(sim, observeMs);
  const at = (to: string) => transitions.find((x) => x.to === to)?.t;
  return { sim, start, pending: at('pending'), firing: at('firing'), resolved: transitions.find((x) => x.to === 'inactive' && x.t > (at('firing') ?? 0))?.t };
}

describe('HighErrorBudgetBurn (Workbook 14.4× on both windows, 5 s for)', () => {
  it('pages ~22 s into a 5% error injection and resolves within ~6 s after it ends', () => {
    const { sim, start, pending, firing, resolved } = burnScenario(51, 0.05, 40_000, 60_000);
    expect(pending! - start).toBeGreaterThan(15_000);
    expect(pending! - start).toBeLessThan(19_000);
    expect(firing! - start).toBeGreaterThan(20_000);
    expect(firing! - start).toBeLessThan(24_000);
    expect(resolved! - (start + 40_000)).toBeLessThanOrEqual(6_000);
    const messages = sim.state.timeline.map((e) => e.message);
    expect(messages.some((m) => m.startsWith('FIRING [page] HighErrorBudgetBurn'))).toBe(true);
    expect(messages).toContain('RESOLVED HighErrorBudgetBurn');
  });

  it('pages in ~9 s at 20% errors', () => {
    const { start, firing } = burnScenario(52, 0.2, 30_000, 30_000);
    expect(firing! - start).toBeGreaterThan(7_000);
    expect(firing! - start).toBeLessThan(11_000);
  });

  it('never pages for a 1% error rate (10× burn is below 14.4×)', () => {
    const { firing } = burnScenario(53, 0.01, 120_000, 120_000);
    expect(firing).toBeUndefined();
  });
});

describe('PodNotReady', () => {
  it('stays quiet for a pod kill that self-heals', () => {
    const sim = new Simulation({ seed: 54 });
    sim.dispatch({ type: 'killPod' });
    run(sim, 60_000);
    expect(sim.state.alerts.find((a) => a.name === 'PodNotReady')!.firedAt).toBeNull();
  });

  it('fires as a ticket when a pod cannot get Ready for 30 s', () => {
    const sim = new Simulation({ seed: 55 });
    const state = sim.state as SimState;
    // Ask for more pods than the 12 slots, and pin the HPA so it doesn't scale the request away.
    state.deployment.desiredReplicas = 13;
    state.hpa.minReplicas = 13;
    state.hpa.maxReplicas = 13;
    run(sim, 45_000);
    const alert = sim.state.alerts.find((a) => a.name === 'PodNotReady')!;
    expect(alert.state).toBe('firing');
    expect(alert.severity).toBe('ticket');
  });
});
