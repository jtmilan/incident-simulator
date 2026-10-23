import { describe, expect, it, vi } from 'vitest';
import { createRegistry } from './registry.ts';

// Plain properties (not methods), so assertions can read the mocks directly.
const handle = () => {
  const h = {
    completed: false,
    pause: vi.fn(),
    complete: vi.fn(() => {
      h.completed = true;
    }),
  };
  return h;
};

const clock = () => ({ pause: vi.fn(), resume: vi.fn() });

describe('motion registry', () => {
  it('tracks running animations and forgets them once they complete', () => {
    const registry = createRegistry({ reduced: false, clock: clock() });
    const a = registry.run(handle());
    registry.run(handle());
    expect(registry.active).toBe(2);
    a.completed = true;
    expect(registry.active).toBe(1);
  });

  it('under reduced motion, never plays: every animation jumps to its end state', () => {
    const registry = createRegistry({ reduced: true, clock: clock() });
    const h = registry.run(handle());
    expect(h.complete).toHaveBeenCalledOnce();
    expect(registry.active).toBe(0);
  });

  it('follows a reduced-motion preference turned on mid-visit', () => {
    const registry = createRegistry({ reduced: false, clock: clock() });
    const running = registry.run(handle());
    registry.setReduced(true);
    expect(running.complete).toHaveBeenCalledOnce();
    expect(registry.active).toBe(0);
    expect(registry.reduced).toBe(true);
    const later = registry.run(handle());
    expect(later.complete).toHaveBeenCalledOnce();
  });

  it('"Pause motion" freezes the shared clock and resumes it once', () => {
    const c = clock();
    const registry = createRegistry({ reduced: false, clock: c });
    registry.setPaused(true);
    registry.setPaused(true);
    expect(registry.paused).toBe(true);
    expect(c.pause).toHaveBeenCalledOnce();
    registry.setPaused(false);
    expect(c.resume).toHaveBeenCalledOnce();
    expect(registry.paused).toBe(false);
  });

  it('animations started while paused show their end state instead of a frozen first frame', () => {
    const c = clock();
    const registry = createRegistry({ reduced: false, clock: c });
    registry.setPaused(true);
    const h = registry.run(handle());
    expect(h.complete).toHaveBeenCalledOnce();
    expect(registry.active).toBe(0);
    expect(c.resume).not.toHaveBeenCalled();
  });

  it('forgets animations the engine cancelled (replaced by a newer one)', () => {
    const registry = createRegistry({ reduced: false, clock: clock() });
    const replaced = { ...handle(), paused: true };
    registry.run(replaced);
    expect(registry.active).toBe(0);
  });
});
