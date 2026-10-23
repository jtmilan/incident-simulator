import { describe, expect, it } from 'vitest';
import { cubicBezier, IRIS_CLOSE_MS, IRIS_EASE, IRIS_OPEN_MS, irisRadius, ModeController, parseMode, type Mode } from './modes.ts';

describe('cubicBezier', () => {
  it('starts at 0, ends at 1, and is linear for the linear curve', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0)).toBeCloseTo(0, 6);
    expect(linear(0.37)).toBeCloseTo(0.37, 4);
    expect(linear(1)).toBeCloseTo(1, 6);
  });

  it('gives the iris curve a slow start, fast middle and slow end', () => {
    expect(IRIS_EASE(0.1)).toBeLessThan(0.05);
    expect(IRIS_EASE(0.5)).toBeCloseTo(0.5, 2);
    expect(IRIS_EASE(0.9)).toBeGreaterThan(0.95);
    expect(IRIS_EASE(-1)).toBe(0);
    expect(IRIS_EASE(2)).toBeCloseTo(1, 6);
  });
});

describe('irisRadius', () => {
  it('reaches the farthest corner plus a margin', () => {
    expect(irisRadius(0, 0, 300, 400)).toBeCloseTo(500 + 48, 6);
    expect(irisRadius(150, 200, 300, 400)).toBeCloseTo(250 + 48, 6);
  });
});

describe('parseMode', () => {
  it('opens the console from #console, ?console or ?mode=console', () => {
    expect(parseMode({ hash: '#console', search: '' })).toBe('console');
    expect(parseMode({ hash: '', search: '?debug&console' })).toBe('console');
    expect(parseMode({ hash: '', search: '?mode=console' })).toBe('console');
    expect(parseMode({ hash: '#other', search: '?debug' })).toBe('hero');
  });
});

function harness(reducedMotion = false, initial: 'hero' | 'console' = 'hero') {
  const modes: Mode[] = [];
  const iris: number[] = [];
  const controller = new ModeController(
    {
      onModeChange: (m) => modes.push(m),
      setIris: (r) => iris.push(r),
      viewport: () => ({ width: 1000, height: 600 }),
      reducedMotion,
    },
    initial,
  );
  return { controller, modes, iris };
}

describe('ModeController', () => {
  it('opens with an iris that grows over 850 ms, then settles in console mode', () => {
    const h = harness();
    h.controller.open(100, 100);
    expect(h.controller.mode).toBe('opening');
    h.controller.tick(1_000);
    h.controller.tick(1_000 + IRIS_OPEN_MS / 2);
    h.controller.tick(1_000 + IRIS_OPEN_MS);
    expect(h.controller.mode).toBe('console');
    expect(h.modes).toEqual(['hero', 'opening', 'console']);
    expect(h.iris[0]).toBe(0);
    expect(h.iris.at(-1)).toBeCloseTo(irisRadius(100, 100, 1000, 600), 6);
    expect(h.iris).toEqual([...h.iris].sort((a, b) => a - b));
  });

  it('closes back to the hero over 620 ms and ignores double requests', () => {
    const h = harness(false, 'console');
    h.controller.open(0, 0); // already in console: ignored
    h.controller.close(500, 300);
    h.controller.close(500, 300);
    h.controller.tick(0);
    h.controller.tick(IRIS_CLOSE_MS);
    expect(h.controller.mode).toBe('hero');
    expect(h.modes).toEqual(['console', 'closing', 'hero']);
    expect(h.iris.at(-1)).toBeCloseTo(0, 6);
  });

  it('skips the animation entirely under reduced motion', () => {
    const h = harness(true);
    h.controller.open(10, 10);
    expect(h.controller.mode).toBe('console');
    expect(h.iris).toEqual([]);
    h.controller.tick(5_000);
    expect(h.modes).toEqual(['hero', 'console']);
  });
});
