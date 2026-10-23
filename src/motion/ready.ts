import type { MotionApi } from './engine.ts';

// The motion engine arrives in its own chunk after first paint. Anything that animates asks for it
// here and falls back to its static end state while (or if) it isn't loaded. No animation library
// is imported, so this stays in the entry chunk at a few hundred bytes.

let api: MotionApi | null = null;
const waiting = new Set<(api: MotionApi) => void>();

export function getMotion(): MotionApi | null {
  return api;
}

/** Runs `fn` once the engine is ready (immediately if it already is). */
export function onMotion(fn: (api: MotionApi) => void): void {
  if (api) fn(api);
  else waiting.add(fn);
}

export function provideMotion(ready: MotionApi): void {
  api = ready;
  waiting.forEach((fn) => fn(ready));
  waiting.clear();
}
