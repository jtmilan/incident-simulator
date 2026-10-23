import { describe, expect, it } from 'vitest';
import { createLoop, MAX_FRAME_MS, type LoopDeps } from './loop.ts';

function fakeDeps() {
  let nextId = 1;
  const pending = new Map<number, (t: number) => void>();
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  let clock = 0;
  const errors: unknown[] = [];
  const deps: LoopDeps = {
    now: () => clock,
    raf: (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    caf: (id) => pending.delete(id),
    doc: doc as unknown as LoopDeps['doc'],
    onError: (error) => errors.push(error),
  };
  return {
    deps,
    errors,
    pendingCount: () => pending.size,
    /** Fire every pending frame at time t. */
    frame(t: number) {
      clock = t;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((cb) => cb(t));
    },
    setHidden(hidden: boolean) {
      doc.hidden = hidden;
      listeners.forEach((fn) => fn());
    },
  };
}

describe('createLoop', () => {
  it('hands every subscriber the same clamped frame delta', () => {
    const f = fakeDeps();
    const loop = createLoop(f.deps);
    const a: number[] = [];
    const b: number[] = [];
    loop.add((dt) => a.push(dt));
    const off = loop.add((dt) => b.push(dt));
    loop.start();

    f.frame(16);
    f.frame(32);
    off();
    f.frame(5_000);

    expect(a).toEqual([16, 16, MAX_FRAME_MS]);
    expect(b).toEqual([16, 16]);
  });

  it('keeps a single pending frame and stops while hidden, resuming without a jump', () => {
    const f = fakeDeps();
    const loop = createLoop(f.deps);
    const dts: number[] = [];
    loop.add((dt) => dts.push(dt));
    loop.start();
    loop.start(); // idempotent
    expect(f.pendingCount()).toBe(1);

    f.frame(16);
    f.setHidden(true);
    expect(loop.running).toBe(false);
    expect(f.pendingCount()).toBe(0);

    f.frame(60_000); // nothing scheduled while hidden
    f.setHidden(false);
    expect(f.pendingCount()).toBe(1);
    f.frame(60_016);
    expect(dts).toEqual([16, 16]);

    loop.stop();
    expect(loop.running).toBe(false);
    f.setHidden(true);
    f.setHidden(false);
    expect(f.pendingCount()).toBe(0);
  });

  it('keeps ticking when a subscriber throws, and reports the error', () => {
    const f = fakeDeps();
    const loop = createLoop(f.deps);
    const ticks: number[] = [];
    loop.add(() => {
      throw new Error('scene blew up');
    });
    loop.add((dt) => ticks.push(dt));
    loop.start();
    f.frame(16);
    f.frame(32);
    expect(ticks).toEqual([16, 16]);
    expect(f.errors).toHaveLength(2);
    expect(f.pendingCount()).toBe(1);
  });

  it('does not start a frame when started in a hidden tab', () => {
    const f = fakeDeps();
    (f.deps.doc as { hidden: boolean }).hidden = true;
    const loop = createLoop(f.deps);
    loop.start();
    expect(f.pendingCount()).toBe(0);
    f.setHidden(false);
    expect(f.pendingCount()).toBe(1);
  });
});
