import { describe, expect, it } from 'vitest';
import { logNormalTail, normalCdf } from './stats.ts';

describe('normalCdf', () => {
  it('matches standard values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(2.3263)).toBeCloseTo(0.99, 3);
  });
});

describe('logNormalTail', () => {
  it('is ~1% at the fitted p99 and ~50% at the fitted p50', () => {
    expect(logNormalTail(40, 140, 140)).toBeCloseTo(0.01, 3);
    expect(logNormalTail(40, 140, 40)).toBeCloseTo(0.5, 3);
  });

  it('is negligible far below the timeout and grows as latency approaches it', () => {
    const healthy = logNormalTail(40, 140, 1_000);
    const degraded = logNormalTail(92, 560, 1_000);
    const awful = logNormalTail(940, 1_040, 1_000);
    expect(healthy).toBeLessThan(1e-6);
    expect(degraded).toBeGreaterThan(healthy);
    expect(awful).toBeGreaterThan(0.05);
  });

  it('handles a median already past the threshold and a degenerate spread', () => {
    expect(logNormalTail(1_200, 1_500, 1_000)).toBeGreaterThan(0.5);
    expect(logNormalTail(500, 500, 1_000)).toBeLessThan(1e-6);
  });
});
