import type { Loop } from '../app/loop.ts';
import { DURATION, EASE, STAGGER } from '../motion/presets.ts';
import { onMotion } from '../motion/ready.ts';
import type { Simulation } from '../sim/simulation.ts';
import { systemStatus } from './status-strip.ts';

// A ring of instrument ticks around the cluster that draws itself in when the page boots, then
// lights four arc segments in the platform's current status colour. Decorative: the status strip
// says the same thing in words.

const SVG = 'http://www.w3.org/2000/svg';
const TICKS = 120;
const ARCS = 4;
/** If the motion engine hasn't arrived by now, show the ring complete and still. */
const FALLBACK_MS = 2_500;

export function mountBootRing(host: HTMLElement, { sim, loop, reducedMotion }: { sim: Simulation; loop: Loop; reducedMotion: boolean }): void {
  const wrap = document.createElement('div');
  wrap.className = 'boot-ring';
  wrap.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');

  const dial = document.createElementNS(SVG, 'g');
  dial.setAttribute('class', 'boot-ticks');
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
    const major = i % 10 === 0;
    const inner = major ? 84 : 87;
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', (100 + inner * Math.cos(a)).toFixed(2));
    line.setAttribute('y1', (100 + inner * Math.sin(a)).toFixed(2));
    line.setAttribute('x2', (100 + 91 * Math.cos(a)).toFixed(2));
    line.setAttribute('y2', (100 + 91 * Math.sin(a)).toFixed(2));
    if (major) line.setAttribute('class', 'major');
    dial.append(line);
    return line;
  });

  // Four arcs with small gaps, drawn with stroke-dash so they can "draw" in.
  const arcs = Array.from({ length: ARCS }, (_, i) => {
    const gap = 0.035;
    const start = i / ARCS + gap / 2;
    const end = (i + 1) / ARCS - gap / 2;
    const p = (t: number) => {
      const a = t * 2 * Math.PI - Math.PI / 2;
      return `${(100 + 96 * Math.cos(a)).toFixed(2)} ${(100 + 96 * Math.sin(a)).toFixed(2)}`;
    };
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', `M ${p(start)} A 96 96 0 0 1 ${p(end)}`);
    path.setAttribute('pathLength', '1');
    path.setAttribute('class', 'boot-arc');
    return path;
  });
  svg.append(dial, ...arcs);
  wrap.append(svg);
  // Under the hero's scrim (the .glow layer), like the 3D scene: dimmed behind the text column,
  // full strength around the cluster.
  const scrim = host.querySelector(':scope > .glow');
  if (scrim) scrim.before(wrap);
  else host.append(wrap);

  // The arcs carry the live status colour (ok / degraded / paging), a few times a second.
  let lastLevel = '';
  let lastCheck = Number.NEGATIVE_INFINITY;
  loop.add((_dt, now) => {
    if (now - lastCheck < 500 || document.body.dataset.mode === 'console') return;
    lastCheck = now;
    const level = systemStatus(sim.state, sim.latest).level;
    if (level !== lastLevel) wrap.dataset.level = lastLevel = level;
  });

  const showStill = () => {
    if (wrap.dataset.state === 'on') return;
    wrap.dataset.state = 'on';
  };
  if (reducedMotion) return showStill();
  wrap.dataset.state = 'waiting';
  const fallback = setTimeout(showStill, FALLBACK_MS);

  onMotion((motion) => {
    // Only a fresh hero boots: a page that opened straight into the console, or a ring already
    // shown by the fallback, stays as it is.
    if (wrap.dataset.state !== 'waiting' || document.body.dataset.mode !== 'hero') return showStill();
    clearTimeout(fallback);
    motion.set(ticks, { opacity: 0 });
    motion.set(arcs, { strokeDashoffset: 1 });
    wrap.dataset.state = 'on';
    const tl = motion.timeline({ defaults: { ease: EASE.enter } });
    tl.add(ticks, { opacity: [0, 1], duration: DURATION.enter, delay: motion.stagger(STAGGER.tick) })
      .add(arcs, { strokeDashoffset: [1, 0], duration: DURATION.section, ease: EASE.state, delay: motion.stagger(120) }, '-=400');
    motion.play(tl);
  });
}
