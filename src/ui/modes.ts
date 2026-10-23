import { parseDeepLink } from './scenarios.ts';

// Hero ⇄ console: the iris transition and the page mode, kept free of the DOM so it is testable.

export type Mode = 'hero' | 'opening' | 'console' | 'closing';

export const IRIS_OPEN_MS = 850;
export const IRIS_CLOSE_MS = 620;

/** CSS-style cubic-bezier easing: solve x(t) = progress for t, return y(t). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (progress) => {
    const p = Math.min(Math.max(progress, 0), 1);
    let t = p;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - p;
      const slope = dx(t);
      if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return y(Math.min(Math.max(t, 0), 1));
  };
}

/** The motion study's iris curve (≈ power3.inOut). */
export const IRIS_EASE = cubicBezier(0.76, 0, 0.24, 1);

/** Radius that covers the whole viewport from (x, y), plus a margin so the edge never shows. */
export function irisRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + 48;
}

export function parseMode(location: { hash: string; search: string }): 'hero' | 'console' {
  // #console, #tour and #scenario=… all land in the control room.
  if (parseDeepLink(location.hash)) return 'console';
  const params = new URLSearchParams(location.search);
  return params.has('console') || params.get('mode') === 'console' ? 'console' : 'hero';
}

export interface ModeHooks {
  onModeChange(mode: Mode): void;
  setIris(radius: number, x: number, y: number): void;
  viewport(): { width: number; height: number };
  reducedMotion: boolean;
}

interface Animation {
  from: number;
  to: number;
  start: number | null;
  duration: number;
  x: number;
  y: number;
  done: Mode;
}

/** Drives the iris from the page's shared clock; reduced motion skips straight to the end state. */
export class ModeController {
  #mode: Mode;
  #animation: Animation | null = null;
  #hooks: ModeHooks;

  constructor(hooks: ModeHooks, initial: 'hero' | 'console') {
    this.#hooks = hooks;
    this.#mode = initial;
    hooks.onModeChange(initial);
  }

  get mode(): Mode {
    return this.#mode;
  }

  open(x: number, y: number): void {
    if (this.#mode !== 'hero') return;
    const { width, height } = this.#hooks.viewport();
    this.#start({ from: 0, to: irisRadius(x, y, width, height), duration: IRIS_OPEN_MS, x, y, done: 'console' }, 'opening');
  }

  close(x: number, y: number): void {
    if (this.#mode !== 'console') return;
    const { width, height } = this.#hooks.viewport();
    this.#start({ from: irisRadius(x, y, width, height), to: 0, duration: IRIS_CLOSE_MS, x, y, done: 'hero' }, 'closing');
  }

  /** Call every frame with the clock's time. */
  tick(nowMs: number): void {
    const a = this.#animation;
    if (!a) return;
    a.start ??= nowMs;
    const progress = Math.min((nowMs - a.start) / a.duration, 1);
    this.#hooks.setIris(a.from + (a.to - a.from) * IRIS_EASE(progress), a.x, a.y);
    if (progress >= 1) {
      this.#animation = null;
      this.#set(a.done);
    }
  }

  #start(animation: Omit<Animation, 'start'>, during: Mode) {
    if (this.#hooks.reducedMotion) {
      this.#set(animation.done);
      return;
    }
    this.#animation = { ...animation, start: null };
    this.#hooks.setIris(animation.from, animation.x, animation.y);
    this.#set(during);
  }

  #set(mode: Mode) {
    this.#mode = mode;
    this.#hooks.onModeChange(mode);
  }
}
