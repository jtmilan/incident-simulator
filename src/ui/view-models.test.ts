import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation.ts';
import type { Postmortem } from '../sim/types.ts';
import {
  ACTIONS,
  budgetRing,
  burnText,
  chaosCards,
  dbText,
  formatClock,
  podsText,
  postmortemRows,
  sparkPoints,
  timelineRows,
} from './view-models.ts';

function run(sim: Simulation, ms: number) {
  for (let i = 0; i < ms / 1_000; i++) sim.advance(1_000);
}

describe('chaosCards', () => {
  it('starts with every action ready', () => {
    const sim = new Simulation({ seed: 91 });
    expect(chaosCards(sim.state, null).map((c) => c.status)).toEqual(['ready', 'ready', 'ready', 'ready', 'ready']);
    expect(ACTIONS.map((a) => a.id)).toEqual(['killPod', 'injectErrors', 'trafficSurge', 'injectLatency', 'failoverDatabase']);
  });

  it('shows a running action with the share of its run still to go', () => {
    const sim = new Simulation({ seed: 92 });
    sim.dispatch({ type: 'trafficSurge', multiplier: 3, durationMs: 60_000 });
    run(sim, 15_000);
    const surge = chaosCards(sim.state, null).find((c) => c.id === 'trafficSurge')!;
    expect(surge.status).toBe('running');
    expect(surge.remaining).toBeGreaterThan(0.7);
    expect(surge.remaining).toBeLessThan(0.8);
  });

  it('cools the kill button down for 3 s and disables failover while one runs', () => {
    const sim = new Simulation({ seed: 93 });
    sim.dispatch({ type: 'failoverDatabase' });
    run(sim, 1_000);
    const killAt = sim.state.t - 1_000;
    const cards = chaosCards(sim.state, killAt);
    expect(cards.find((c) => c.id === 'killPod')!.status).toBe('cooldown');
    expect(cards.find((c) => c.id === 'failoverDatabase')!.status).toBe('running');
    run(sim, 26_000); // failover run over, old primary still rejoining
    expect(chaosCards(sim.state, killAt).find((c) => c.id === 'failoverDatabase')!.status).toBe('disabled');
    expect(chaosCards(sim.state, killAt).find((c) => c.id === 'killPod')!.status).toBe('ready');
  });
});

describe('formatting', () => {
  it('formats clocks, budget, burn, pods and DB lines', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(125_400)).toBe('2:05');
    expect(budgetRing(0.83)).toEqual({ pct: '83%', tone: 'ok', fraction: 0.83 });
    expect(budgetRing(0.3).tone).toBe('warn');
    expect(budgetRing(-0.2)).toEqual({ pct: '-20%', tone: 'crit', fraction: 0 });

    const sim = new Simulation({ seed: 94 });
    run(sim, 5_000);
    expect(burnText(sim.state.slo)).toMatch(/^\d+\.\d× \(60 s\) · \d+\.\d× \(5 s\) · pages at 14\.4×$/);
    expect(podsText(sim.state)).toEqual({ text: '3 ready / 3 desired · HPA target 60%', hold: null });
    expect(dbText(sim.state)).toMatch(/^db-1 primary · db-2 replica\nhealthy · lag \d+ ms · pool \d+\/20$/);
  });
});

describe('sparkPoints', () => {
  it('maps values into the box from a zero floor', () => {
    const pts = sparkPoints([0, 50, 100], 102, 30, 1);
    expect(pts.map((p) => p.x)).toEqual([1, 51, 101]);
    expect(pts[0]!.y).toBe(29);
    expect(pts[2]!.y).toBeGreaterThan(1);
    expect(pts[2]!.y).toBeLessThan(pts[1]!.y);
    expect(sparkPoints([], 10, 10)).toEqual([]);
    expect(sparkPoints([0, 0], 10, 10)[0]!.y).toBe(8);
  });
});

describe('timeline and postmortem', () => {
  it('lists the newest entries first', () => {
    const sim = new Simulation({ seed: 95 });
    sim.dispatch({ type: 'killPod' });
    run(sim, 12_000);
    const rows = timelineRows(sim.state.timeline, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.seq).toBeGreaterThan(rows[2]!.seq);
  });

  it('renders a postmortem with a self-healed case', () => {
    const pm: Postmortem = {
      startedAt: 0,
      endedAt: 9_000,
      timeToDetectMs: null,
      timeToRecoverMs: 9_000,
      budgetBurned: 0.0012,
      peakErrorRatio: 0.0003,
      peakP99: 152,
      alertsFired: [],
      chaos: ['killPod'],
    };
    expect(postmortemRows(pm)).toEqual([
      ['Chaos', 'kill pod'],
      ['Time to detect', 'not paged (self-healed)'],
      ['Time to recover', '0:09'],
      ['Error budget burned', '0.1%'],
      ['Peak error rate', '0.03%'],
      ['Peak p99', '152 ms'],
      ['Alerts', 'none'],
    ]);
  });
});
