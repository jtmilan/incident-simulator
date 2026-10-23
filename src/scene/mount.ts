import type { Loop } from '../app/loop.ts';
import { motion } from '../app/motion.ts';
import type { Simulation } from '../sim/simulation.ts';
import { createClusterScene } from './cluster-scene.ts';
import { currentDevice, pickQuality } from './quality.ts';

/**
 * Puts the cluster scene behind the page. Returns a disposer, or null when WebGL isn't available,
 * in which case the static placeholder layout simply stays as it is.
 */
const nextIdle = () =>
  new Promise<void>((resolve) => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 50);
  });

/**
 * Builds the scene in separate idle tasks (build → compile shaders → first frame) so no single
 * task blocks the page for long, even on devices that render WebGL on the CPU.
 */
export interface SceneHandle {
  setFraming(framing: 'hero' | 'console', immediate?: boolean): void;
  setLabelsVisible(visible: boolean): void;
  dispose(): void;
}

export async function mountScene({ sim, loop }: { sim: Simulation; loop: Loop }): Promise<SceneHandle | null> {
  const canvas = document.createElement('canvas');
  canvas.className = 'scene';
  canvas.setAttribute('aria-hidden', 'true');

  const quality = pickQuality(currentDevice());
  let scene: ReturnType<typeof createClusterScene>;
  try {
    scene = createClusterScene(canvas, sim, quality);
  } catch {
    return null;
  }
  document.body.dataset.sceneTier = quality.tier;
  await nextIdle();
  scene.prewarm();
  await nextIdle();

  document.body.prepend(canvas);
  document.body.classList.add('has-scene');

  const resize = () => scene.resize(window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener('resize', resize);

  // Frame cap plus a frame-time governor: when frames get expensive (weak GPU, or WebGL on the CPU)
  // the scene sheds bloom, resolution and particles, then renders less often, so the page stays responsive.
  let maxFps = quality.maxFps;
  let lastRender = Number.NEGATIVE_INFINITY;
  let pendingDt = 0;
  let averageCost = 0;
  let lastDegrade = 0;
  const off = loop.add((dt, now) => {
    if (motion.paused) return; // keep the last frame on screen
    pendingDt += dt;
    if (now - lastRender < 1_000 / maxFps - 1) return;
    const start = performance.now();
    scene.update(pendingDt, now);
    scene.render();
    const cost = performance.now() - start;
    pendingDt = 0;
    lastRender = now;
    averageCost = averageCost === 0 ? cost : averageCost * 0.85 + cost * 0.15;
    if (averageCost > 20 && now - lastDegrade > 2_000) {
      lastDegrade = now;
      if (!scene.degrade()) maxFps = Math.max(8, Math.floor(maxFps / 2));
    }
  });

  return {
    setFraming: (framing, immediate) => scene.setFraming(framing, immediate),
    setLabelsVisible: (visible) => scene.setLabelsVisible(visible),
    dispose() {
      off();
      window.removeEventListener('resize', resize);
      scene.dispose();
      canvas.remove();
      document.body.classList.remove('has-scene');
    },
  };
}
