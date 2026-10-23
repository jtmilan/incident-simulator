// Page-wide "pause motion" switch (WCAG 2.2.2): stops the simulation, the 3D scene and CSS pulses.

let paused = false;
const listeners = new Set<(paused: boolean) => void>();

export const motion = {
  get paused() {
    return paused;
  },
  set(next: boolean) {
    paused = next;
    document.body.classList.toggle('motion-paused', next);
    listeners.forEach((fn) => fn(next));
  },
  subscribe(fn: (paused: boolean) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
