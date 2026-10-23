export type FrameFn = (dtMs: number, nowMs: number) => void;

export interface LoopDeps {
  now(): number;
  raf(callback: (t: number) => void): number;
  caf(id: number): void;
  doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
}

export interface Loop {
  add(fn: FrameFn): () => void;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** Longest frame step handed to subscribers; a stall never becomes a jump. */
export const MAX_FRAME_MS = 250;

const browserDeps = (): LoopDeps => ({
  now: () => performance.now(),
  raf: (callback) => requestAnimationFrame(callback),
  caf: (id) => cancelAnimationFrame(id),
  doc: document,
});

/**
 * The page's one clock: a single requestAnimationFrame loop that advances the simulator and
 * draws the scene and panels. It stops while the tab is hidden and resumes without a time jump.
 */
export function createLoop(deps: LoopDeps = browserDeps()): Loop {
  const subscribers = new Set<FrameFn>();
  let id: number | null = null;
  let last = 0;
  let started = false;

  const frame = (t: number) => {
    const dt = Math.min(Math.max(t - last, 0), MAX_FRAME_MS);
    last = t;
    subscribers.forEach((fn) => fn(dt, t));
    id = deps.raf(frame);
  };

  const halt = () => {
    if (id !== null) deps.caf(id);
    id = null;
  };

  const resume = () => {
    halt();
    last = deps.now();
    id = deps.raf(frame);
  };

  const onVisibility = () => {
    if (!started) return;
    if (deps.doc.hidden) halt();
    else resume();
  };

  return {
    add(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    start() {
      if (started) return;
      started = true;
      deps.doc.addEventListener('visibilitychange', onVisibility);
      if (!deps.doc.hidden) resume();
    },
    stop() {
      started = false;
      deps.doc.removeEventListener('visibilitychange', onVisibility);
      halt();
    },
    get running() {
      return id !== null;
    },
  };
}
