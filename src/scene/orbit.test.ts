import { describe, expect, it } from 'vitest';
import { ORBIT_AZIMUTH_RAD, ORBIT_ELEVATION_RAD, orbitCamera } from './orbit.ts';

const base = { x: 0, y: 11, z: 23 };
const target = { x: 0, y: 0, z: -2.5 };
const dist = (a: { x: number; y: number; z: number }) => Math.hypot(a.x - target.x, a.y - target.y, a.z - target.z);

describe('orbitCamera', () => {
  it('leaves the camera where it is at p = 0', () => {
    const p0 = orbitCamera(base, target, 0);
    expect(p0.x).toBeCloseTo(base.x, 9);
    expect(p0.y).toBeCloseTo(base.y, 9);
    expect(p0.z).toBeCloseTo(base.z, 9);
  });

  it('swings 20° around and 8° up at p = 1, keeping its distance to the look-at point', () => {
    const p1 = orbitCamera(base, target, 1);
    expect(dist(p1)).toBeCloseTo(dist(base), 9);
    const azimuth = Math.atan2(p1.x - target.x, p1.z - target.z);
    expect(azimuth).toBeCloseTo(ORBIT_AZIMUTH_RAD, 9);
    const elevation0 = Math.atan2(base.y - target.y, Math.hypot(base.x - target.x, base.z - target.z));
    const elevation1 = Math.atan2(p1.y - target.y, Math.hypot(p1.x - target.x, p1.z - target.z));
    expect(elevation1 - elevation0).toBeCloseTo(ORBIT_ELEVATION_RAD, 9);
  });

  it('writes into a caller-owned vector (no allocation per frame)', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(orbitCamera(base, target, 0.5, out)).toBe(out);
    expect(orbitCamera(base, target, 0, out)).toEqual(base);
  });

  it('moves monotonically with progress and clamps outside 0..1', () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((p) => orbitCamera(base, target, p).x);
    xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(xs[i]!));
    expect(orbitCamera(base, target, 2)).toEqual(orbitCamera(base, target, 1));
    expect(orbitCamera(base, target, -1)).toEqual(orbitCamera(base, target, 0));
  });
});
