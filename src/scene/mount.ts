import type { Loop } from '../app/loop.ts';
import type { Simulation } from '../sim/simulation.ts';
import { createClusterScene } from './cluster-scene.ts';
import { currentDevice, pickQuality } from './quality.ts';

/**
 * Puts the cluster scene behind the page. Returns a disposer, or null when WebGL isn't available,
 * in which case the static placeholder layout simply stays as it is.
 */
export function mountScene({ sim, loop }: { sim: Simulation; loop: Loop }): (() => void) | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'scene';
  canvas.setAttribute('aria-hidden', 'true');

  let scene: ReturnType<typeof createClusterScene>;
  try {
    scene = createClusterScene(canvas, sim, pickQuality(currentDevice()));
  } catch {
    return null;
  }

  document.body.prepend(canvas);
  document.body.classList.add('has-scene');

  const resize = () => scene.resize(window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener('resize', resize);

  const off = loop.add((dt, now) => {
    scene.update(dt, now);
    scene.render();
  });

  return () => {
    off();
    window.removeEventListener('resize', resize);
    scene.dispose();
    canvas.remove();
    document.body.classList.remove('has-scene');
  };
}
