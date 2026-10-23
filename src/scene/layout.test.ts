import { describe, expect, it } from 'vitest';
import { heatColor, hexToRgb, PALETTE } from './palette.ts';
import { NODE_CENTRES, PLATFORM_TOP, SlotBook, slotPosition } from './layout.ts';

describe('SlotBook', () => {
  it('gives each scheduled pod a stable slot and frees it when the pod goes', () => {
    const book = new SlotBook();
    const first = book.assign([
      { id: 'a1', nodeId: 'node-a' },
      { id: 'b1', nodeId: 'node-b' },
      { id: 'p1', nodeId: null },
    ]);
    expect(first.get('a1')).toEqual({ nodeId: 'node-a', slot: 0 });
    expect(first.has('p1')).toBe(false);

    const second = book.assign([
      { id: 'a2', nodeId: 'node-a' },
      { id: 'a1', nodeId: 'node-a' },
      { id: 'b1', nodeId: 'node-b' },
    ]);
    expect(second.get('a1')).toEqual({ nodeId: 'node-a', slot: 0 });
    expect(second.get('a2')).toEqual({ nodeId: 'node-a', slot: 1 });

    const third = book.assign([
      { id: 'a2', nodeId: 'node-a' },
      { id: 'a3', nodeId: 'node-a' },
    ]);
    expect(third.has('a1')).toBe(false);
    expect(third.get('a2')!.slot).toBe(1);
    expect(third.get('a3')!.slot).toBe(0);
  });

  it('never assigns more than four slots on a node', () => {
    const book = new SlotBook();
    const pods = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, nodeId: 'node-c' }));
    expect(book.assign(pods).size).toBe(4);
  });
});

describe('slotPosition', () => {
  it('places pods on top of their node platform, around its centre', () => {
    const p = slotPosition({ nodeId: 'node-b', slot: 3 });
    expect(p.y).toBe(PLATFORM_TOP);
    expect(p.x).toBeGreaterThan(NODE_CENTRES['node-b']!.x);
    expect(p.z).toBeGreaterThan(NODE_CENTRES['node-b']!.z);
    expect(slotPosition({ nodeId: 'node-x', slot: 9 })).toEqual({ x: 0, y: PLATFORM_TOP, z: 0 });
  });
});

const expectRgb = (actual: { r: number; g: number; b: number }, expected: { r: number; g: number; b: number }) => {
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
};

describe('heatColor', () => {
  it('stays cyan to the HPA target, warms to amber, then red when shedding', () => {
    expectRgb(heatColor(0.45), hexToRgb(PALETTE.accent));
    expectRgb(heatColor(1.2), hexToRgb(PALETTE.warn));
    expectRgb(heatColor(1.8), hexToRgb(PALETTE.crit));
    const mid = heatColor(0.9);
    expect(mid.r).toBeGreaterThan(hexToRgb(PALETTE.accent).r);
    expect(mid.r).toBeLessThan(hexToRgb(PALETTE.warn).r);
  });
});
