// The motion vocabulary, from the animejs.com study (05-02-RESEARCH.md): a small set of eases,
// durations and stagger steps, used everywhere so the page moves with one voice.

export const EASE = {
  /** Entrances: power-3 ease-out. */
  enter: 'out(3)',
  /** State changes: power-3 ease-in-out. */
  state: 'inOut(3)',
  /** Exits. */
  exit: 'in(2)',
  /** Loops and scrubbing. */
  loop: 'linear',
} as const;

export const DURATION = {
  micro: 250,
  enter: 350,
  state: 500,
  section: 1_000,
} as const;

/** Per-item delay in a cascade (ms). */
export const STAGGER = {
  tick: 10,
  row: 20,
  panel: 40,
} as const;

/** Spring for presses: quick, barely any overshoot. */
export const PRESS_SPRING = { stiffness: 120, damping: 12 } as const;

/** Lit ticks on the error-budget dial: rounds to the nearest tick, never below 0 or above n. */
export function dialTicks(remaining: number, n: number): number {
  if (!Number.isFinite(remaining)) return 0;
  return Math.min(Math.max(Math.round(remaining * n), 0), n);
}

/**
 * The ticks whose lit state changes between two counts, in the order they should animate:
 * draining switches off from the old boundary back, refilling lights up from the old boundary out.
 */
export function dialChange(from: number, to: number): { indices: number[]; lit: boolean } {
  if (to < from) return { indices: Array.from({ length: from - to }, (_, i) => from - 1 - i), lit: false };
  return { indices: Array.from({ length: to - from }, (_, i) => from + i), lit: true };
}
