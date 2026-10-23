import { describe, expect, it } from 'vitest';
import { DURATION, EASE, STAGGER, dialChange, dialTicks } from './presets.ts';

describe('motion presets', () => {
  it('keep the studied vocabulary: power-3 eases, 250–1000 ms, 10–40 ms staggers', () => {
    expect(EASE.enter).toBe('out(3)');
    expect(EASE.state).toBe('inOut(3)');
    expect(Object.values(DURATION)).toEqual([250, 350, 500, 1_000]);
    expect(Object.values(STAGGER)).toEqual([10, 20, 40]);
  });
});

describe('dialTicks', () => {
  it('lights round(remaining × n) ticks, clamped to the dial', () => {
    expect(dialTicks(1, 60)).toBe(60);
    expect(dialTicks(0.5, 60)).toBe(30);
    expect(dialTicks(0.347, 60)).toBe(21);
    expect(dialTicks(0, 60)).toBe(0);
    expect(dialTicks(-0.3, 60)).toBe(0); // overspent budget
    expect(dialTicks(1.2, 60)).toBe(60);
    expect(dialTicks(Number.NaN, 60)).toBe(0);
  });
});

describe('dialChange', () => {
  it('switches ticks off from the old boundary back when draining', () => {
    expect(dialChange(60, 57)).toEqual({ indices: [59, 58, 57], lit: false });
  });

  it('lights ticks from the old boundary out when the budget recovers', () => {
    expect(dialChange(10, 13)).toEqual({ indices: [10, 11, 12], lit: true });
  });

  it('changes nothing when the count holds', () => {
    expect(dialChange(42, 42)).toEqual({ indices: [], lit: true });
  });
});
