import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());

    expect(seqA).toEqual(seqB);
    expect(createRng(43).next()).not.toBe(seqA[0]);
  });

  it('stays inside the requested bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);

      const r = rng.range(2_000, 4_000);
      expect(r).toBeGreaterThanOrEqual(2_000);
      expect(r).toBeLessThan(4_000);

      const n = rng.int(1, 3);
      expect([1, 2, 3]).toContain(n);
    }
  });

  it('picks from a list and refuses an empty one', () => {
    const rng = createRng(1);
    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    expect(() => rng.pick([])).toThrow(/empty/);
  });

  it('exposes its internal state for debugging', () => {
    const rng = createRng(5);
    const before = rng.state;
    rng.next();
    expect(rng.state).not.toBe(before);
  });
});
