import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../sim/config.ts';
import { Simulation } from '../sim/simulation.ts';
import type { SimEvent } from '../sim/types.ts';
import { placeCard, statusLine, TOUR_STEPS, type TourStep } from './tour-script.ts';

const CONSOLE_TOUR_IDS = [
  'cluster',
  'actions',
  'action-killPod',
  'action-injectErrors',
  'action-trafficSurge',
  'action-injectLatency',
  'action-failoverDatabase',
  'recover',
  'slo',
  'signals',
  'pods',
  'db',
  'alerts',
  'timeline',
  'postmortem',
];

/** Runs one step at 1× like the tour does: its actions, then ticks until its condition or timeout. */
function runStep(sim: Simulation, step: TourStep): { tookMs: number; met: SimEvent | null } {
  step.actions?.forEach((c) => sim.dispatch(c));
  const start = sim.state.t;
  if (!step.waitFor) {
    sim.advance(TICK_MS);
    return { tookMs: 0, met: null };
  }
  const limit = step.timeoutMs ?? 60_000;
  for (let elapsed = 0; elapsed <= limit; elapsed += TICK_MS) {
    const met = sim.advance(TICK_MS).find((e) => step.waitFor!(e, sim.state));
    if (met) return { tookMs: sim.state.t - start, met };
  }
  return { tookMs: Number.POSITIVE_INFINITY, met: null };
}

describe('TOUR_STEPS', () => {
  it('has six steps that each point at a real console element', () => {
    expect(TOUR_STEPS).toHaveLength(6);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(40);
      expect(CONSOLE_TOUR_IDS).toContain(step.target);
      if (step.doneTarget) expect(CONSOLE_TOUR_IDS).toContain(step.doneTarget);
      if (step.waitFor) {
        expect(step.waiting).toBeTruthy();
        expect(step.done).toBeTypeOf('function');
        expect(step.timeoutMs).toBeGreaterThan(0);
      }
    }
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it('plays out on a real simulation at 1×: heal, page, recover, each inside its timeout and ≤ 100 s in all', () => {
    const sim = new Simulation({ seed: 1 });
    sim.advance(5_000); // the tour can start at any point; it resets first
    let total = 0;
    const lines: string[] = [];
    for (const step of TOUR_STEPS) {
      const { tookMs, met } = runStep(sim, step);
      if (step.waitFor) {
        expect(met, `${step.id} never met its condition`).not.toBeNull();
        expect(tookMs).toBeLessThanOrEqual(step.timeoutMs!);
        lines.push(step.done!(met!, sim.state));
      }
      total += tookMs;
    }
    expect(sim.speed).toBe(1);
    expect(total).toBeLessThanOrEqual(100_000);
    expect(lines[0]).toMatch(/^✓ Healed in \d+ s\. Postmortem: not paged \(self-healed\)\.$/);
    expect(lines[1]).toBe('● HighErrorBudgetBurn is firing.');
    expect(lines[2]).toMatch(/^✓ paged after \d+ s, recovered in \d+ s, \d+\.\d% of the error budget burned\.$/);
  });

  it('holds across seeds (the tour must never leave a visitor waiting)', () => {
    for (const seed of [2, 3, 5, 8, 13, 21, 34]) {
      const sim = new Simulation({ seed });
      for (const step of TOUR_STEPS) {
        const { met } = runStep(sim, step);
        if (step.waitFor) expect(met, `seed ${seed}: ${step.id}`).not.toBeNull();
      }
    }
  });

  it('copy derives its numbers from the simulator config', () => {
    const all = TOUR_STEPS.map((s) => `${s.title} ${s.body}`).join(' ');
    expect(all).toContain('3 pods across 3 zones');
    expect(all).toContain('99.9%');
    expect(all).toContain('20% of requests for 30 s');
    expect(all).toContain('14.4×');
    expect(all).toContain('60 s here');
    expect(all).toContain('300 s before scaling down');
  });
});

describe('statusLine', () => {
  const [, kill, , page] = TOUR_STEPS as [TourStep, TourStep, TourStep, TourStep];

  it('is empty for a step that waits for nothing', () => {
    expect(statusLine(page, { met: false, startedAt: 0 }, 99_000)).toBe('');
  });

  it('says what it is waiting for, then what happened', () => {
    expect(statusLine(kill, { met: false, startedAt: 1_000 }, 5_000)).toBe(kill.waiting);
    expect(statusLine(kill, { met: true, text: '✓ Healed.' }, 5_000)).toBe('✓ Healed.');
  });

  it('says when paused motion is holding the experiment, and when a Reset cleared it', () => {
    expect(statusLine(kill, { met: false, startedAt: 0 }, 1_000, true)).toMatch(/Motion is paused/);
    expect(statusLine(kill, { met: false, startedAt: 0, interrupted: true }, 1_000)).toMatch(/scenario was reset/);
    expect(statusLine(page, { met: false, startedAt: 0 }, 1_000, true)).toBe('');
  });

  it('never leaves the visitor stuck: past the timeout it invites them on', () => {
    expect(statusLine(kill, { met: false, startedAt: 0 }, kill.timeoutMs! + 100)).toMatch(/Continue whenever you like/);
  });
});

describe('placeCard', () => {
  const card = { width: 340, height: 220 };
  const viewport = { width: 1440, height: 900 };

  it('sits to the right of a target with room beside it', () => {
    expect(placeCard({ left: 24, top: 120, width: 280, height: 90 }, card, viewport)).toEqual({ left: 318, top: 120 });
  });

  it('falls back to the left, then below, then above', () => {
    expect(placeCard({ left: 1100, top: 120, width: 320, height: 90 }, card, viewport)).toEqual({ left: 746, top: 120 });
    const phone = { width: 390, height: 844 };
    const narrowCard = { width: 358, height: 220 };
    expect(placeCard({ left: 16, top: 100, width: 358, height: 200 }, narrowCard, phone)).toEqual({ left: 16, top: 314 });
    expect(placeCard({ left: 16, top: 500, width: 358, height: 200 }, narrowCard, phone)).toEqual({ left: 16, top: 266 });
  });

  it('tucks into the bottom-left of a target too big to sit beside', () => {
    const pos = placeCard({ left: 300, top: 80, width: 840, height: 640 }, card, viewport);
    expect(pos).toEqual({ left: 314, top: 486 });
  });

  it('centres at the bottom when there is no visible target, and always stays on screen', () => {
    expect(placeCard(null, card, viewport)).toEqual({ left: 550, top: 664 });
    expect(placeCard({ left: 0, top: 0, width: 0, height: 0 }, card, viewport)).toEqual({ left: 550, top: 664 });
    const pos = placeCard({ left: -500, top: 2_000, width: 10, height: 10 }, card, viewport);
    expect(pos.left).toBeGreaterThanOrEqual(16);
    expect(pos.top + card.height).toBeLessThanOrEqual(viewport.height - 16);
  });
});
