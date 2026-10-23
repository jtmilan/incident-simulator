export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Current internal state, exposed for the debug view. */
  readonly state: number;
}

// mulberry32: tiny, fast and good enough for a simulation. Seeded so every run of a
// scenario (and every test) is reproducible.
export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('cannot pick from an empty list');
      return items[Math.floor(next() * items.length)] as T;
    },
    get state() {
      return s;
    },
  };
}
