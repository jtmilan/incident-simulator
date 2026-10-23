import { isSoftwareRenderer, webglRendererName } from '../app/gpu.ts';

export type Tier = 'high' | 'medium' | 'low' | 'software';

export interface Quality {
  tier: Tier;
  /** Upper bound for renderer pixel ratio. */
  dprCap: number;
  bloom: 'full' | 'half' | 'off';
  /** Traffic particle budget (03-02). */
  particles: number;
  antialias: boolean;
  /** Frame cap for the scene; the simulation itself always runs at full rate. */
  maxFps: number;
  /** Ambient camera drift and idle motion; off for prefers-reduced-motion. */
  drift: boolean;
}

export interface Device {
  dpr: number;
  width: number;
  cores: number;
  reducedMotion: boolean;
  /** WebGL is running on the CPU (SwiftShader, llvmpipe…): every frame costs main-thread time. */
  software: boolean;
}

const TIERS: Record<Tier, Omit<Quality, 'tier' | 'drift'>> = {
  high: { dprCap: 2, bloom: 'full', particles: 600, antialias: true, maxFps: 60 },
  medium: { dprCap: 1.5, bloom: 'half', particles: 300, antialias: true, maxFps: 60 },
  low: { dprCap: 1, bloom: 'off', particles: 120, antialias: false, maxFps: 60 },
  // No GPU: render at half resolution, a few times a second, so the page stays responsive.
  software: { dprCap: 0.5, bloom: 'off', particles: 80, antialias: false, maxFps: 12 },
};

/** A few fixed levels rather than continuous knobs: cheap to reason about and to test. */
export function pickQuality({ dpr, width, cores, reducedMotion, software }: Device): Quality {
  const tier: Tier = software ? 'software' : cores <= 2 ? 'low' : width >= 1024 && cores >= 6 ? 'high' : 'medium';
  return { tier, ...TIERS[tier], dprCap: Math.min(TIERS[tier].dprCap, Math.max(dpr, 1)), drift: !reducedMotion };
}

export function currentDevice(): Device {
  return {
    dpr: window.devicePixelRatio || 1,
    width: window.innerWidth,
    cores: navigator.hardwareConcurrency || 4,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    software: isSoftwareRenderer(webglRendererName()),
  };
}
