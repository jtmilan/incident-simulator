// Scene colours, straight from the design tokens (src/styles/tokens.css).
export const PALETTE = {
  bg: 0x0a0e13,
  panel: 0x111820,
  grid: 0x1c2631,
  text: 0xe6edf3,
  muted: 0x7c8896,
  accent: 0x4cc9f0,
  ok: 0x3ddc97,
  warn: 0xf5a524,
  crit: 0xff4d5e,
} as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: number): Rgb {
  return { r: ((hex >> 16) & 0xff) / 255, g: ((hex >> 8) & 0xff) / 255, b: (hex & 0xff) / 255 };
}

const mix = (a: Rgb, b: Rgb, k: number): Rgb => ({
  r: a.r + (b.r - a.r) * k,
  g: a.g + (b.g - a.g) * k,
  b: a.b + (b.b - a.b) * k,
});

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/**
 * Pod colour by CPU (fraction of request): cyan up to the 60% HPA target, warming to amber at
 * 120%, and to critical red at 180% (where the app is shedding load).
 */
export function heatColor(cpu: number): Rgb {
  const accent = hexToRgb(PALETTE.accent);
  const warn = hexToRgb(PALETTE.warn);
  const crit = hexToRgb(PALETTE.crit);
  if (cpu <= 0.6) return accent;
  if (cpu <= 1.2) return mix(accent, warn, clamp01((cpu - 0.6) / 0.6));
  return mix(warn, crit, clamp01((cpu - 1.2) / 0.6));
}
