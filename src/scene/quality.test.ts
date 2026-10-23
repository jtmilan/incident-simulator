import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer } from '../app/gpu.ts';
import { pickQuality } from './quality.ts';

describe('pickQuality', () => {
  it('gives a desktop the full treatment', () => {
    expect(pickQuality({ dpr: 2, width: 1440, cores: 8, reducedMotion: false, software: false })).toEqual({
      tier: 'high',
      dprCap: 2,
      bloom: 'full',
      particles: 600,
      antialias: true,
      maxFps: 60,
      drift: true,
    });
  });

  it('steps a phone down to medium: lower DPR, half-resolution bloom, fewer particles', () => {
    const q = pickQuality({ dpr: 3, width: 390, cores: 6, reducedMotion: false, software: false });
    expect([q.tier, q.dprCap, q.bloom, q.particles]).toEqual(['medium', 1.5, 'half', 300]);
  });

  it('turns bloom and antialiasing off on very weak devices', () => {
    const q = pickQuality({ dpr: 2, width: 1280, cores: 2, reducedMotion: false, software: false });
    expect([q.tier, q.dprCap, q.bloom, q.particles, q.antialias]).toEqual(['low', 1, 'off', 120, false]);
  });

  it('never raises the pixel ratio above the device, and drops drift for reduced motion', () => {
    const q = pickQuality({ dpr: 1, width: 1920, cores: 12, reducedMotion: true, software: false });
    expect(q.dprCap).toBe(1);
    expect(q.drift).toBe(false);
  });
});

describe('software rendering', () => {
  it('recognises CPU-backed WebGL renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });

  it('renders at half resolution, without bloom, a few times a second', () => {
    const q = pickQuality({ dpr: 2, width: 1440, cores: 8, reducedMotion: false, software: true });
    expect([q.tier, q.dprCap, q.bloom, q.particles, q.maxFps]).toEqual(['software', 0.5, 'off', 80, 12]);
  });
});
