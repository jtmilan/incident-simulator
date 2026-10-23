import { describe, expect, it } from 'vitest';
import { pickQuality } from './quality.ts';

describe('pickQuality', () => {
  it('gives a desktop the full treatment', () => {
    expect(pickQuality({ dpr: 2, width: 1440, cores: 8, reducedMotion: false })).toEqual({
      tier: 'high',
      dprCap: 2,
      bloom: 'full',
      particles: 600,
      antialias: true,
      drift: true,
    });
  });

  it('steps a phone down to medium: lower DPR, half-resolution bloom, fewer particles', () => {
    const q = pickQuality({ dpr: 3, width: 390, cores: 6, reducedMotion: false });
    expect([q.tier, q.dprCap, q.bloom, q.particles]).toEqual(['medium', 1.5, 'half', 300]);
  });

  it('turns bloom and antialiasing off on very weak devices', () => {
    const q = pickQuality({ dpr: 2, width: 1280, cores: 2, reducedMotion: false });
    expect([q.tier, q.dprCap, q.bloom, q.particles, q.antialias]).toEqual(['low', 1, 'off', 120, false]);
  });

  it('never raises the pixel ratio above the device, and drops drift for reduced motion', () => {
    const q = pickQuality({ dpr: 1, width: 1920, cores: 12, reducedMotion: true });
    expect(q.dprCap).toBe(1);
    expect(q.drift).toBe(false);
  });
});
