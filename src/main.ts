import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/hero.css';
import './styles/console.css';

import { isSoftwareRenderer, webglRendererName } from './app/gpu.ts';
import { createLoop } from './app/loop.ts';
import { goatCounterCode, injectGoatCounter } from './config/analytics.ts';
import { getBuildInfo } from './config/build-info.ts';
import type { SceneHandle } from './scene/mount.ts';
import { Simulation } from './sim/simulation.ts';
import { mountConsole } from './ui/console.ts';
import { mountHeadline } from './ui/headline.ts';
import { ModeController, parseMode, type Mode } from './ui/modes.ts';
import { mountStatusStrip } from './ui/status-strip.ts';

function linkOrText(label: string, href: string | null, testId: string): HTMLElement {
  const el = document.createElement(href ? 'a' : 'span');
  el.textContent = label;
  el.dataset.testid = testId;
  if (href && el instanceof HTMLAnchorElement) el.href = href;
  return el;
}

function renderProvenance(target: HTMLElement): void {
  const info = getBuildInfo(import.meta.env);

  const build = document.createElement('span');
  build.append('build ', linkOrText(info.shortSha, info.commitUrl, 'build-sha'));

  const run = document.createElement('span');
  run.append('run ', linkOrText(info.runId === 'local' ? 'local' : `#${info.runId}`, info.runUrl, 'build-run'));

  const time = document.createElement('time');
  time.textContent = info.buildTime;
  if (info.buildTime !== 'unknown') time.dateTime = info.buildTime;

  const source = linkOrText('source', info.repoUrl, 'repo-link');

  target.replaceChildren(build, run, time, source);
}

const provenance = document.querySelector<HTMLElement>('[data-provenance]');
if (provenance) renderProvenance(provenance);

const counter = goatCounterCode(import.meta.env);
if (counter) injectGoatCounter(document, counter);

// One simulator and one clock for everything on the page. The status strip reads it from the start.
const sim = new Simulation({ seed: 1 });
const loop = createLoop();
loop.add((dt) => sim.advance(dt));
const statusRoot = document.querySelector<HTMLElement>('[data-testid="status"]');
if (statusRoot) mountStatusStrip(statusRoot, { sim, loop });
loop.start();

const debug = new URLSearchParams(window.location.search).has('debug');
if (debug) (window as unknown as { __ccr?: { sim: Simulation } }).__ccr = { sim };

const headline = document.querySelector<HTMLElement>('[data-headline]');
if (headline) mountHeadline(headline);

// ---- Console panels ----
const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`);
const chaosRegion = region('chaos');
const metricsRegion = region('metrics');
const timelineRegion = region('timeline');
const viewportRegion = region('viewport');
if (chaosRegion && metricsRegion && timelineRegion && viewportRegion) {
  mountConsole({ chaos: chaosRegion, metrics: metricsRegion, timeline: timelineRegion, viewport: viewportRegion }, { sim, loop });
}

// ---- Hero ⇄ console ----
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = document.querySelector<HTMLElement>('.hero');
const consoleLayer = document.querySelector<HTMLElement>('.console');
const consoleTitle = document.querySelector<HTMLElement>('#console-title');
const enterButton = document.querySelector<HTMLButtonElement>('[data-enter]');
const backButton = document.querySelector<HTMLButtonElement>('[data-back]');
let scene: SceneHandle | null = null;
let previousMode: Mode | null = null;

const applyMode = (mode: Mode) => {
  document.body.dataset.mode = mode;
  const showingConsole = mode !== 'hero';
  if (hero) hero.inert = mode === 'console';
  if (consoleLayer) consoleLayer.inert = mode === 'hero';
  scene?.setFraming(showingConsole && mode !== 'closing' ? 'console' : 'hero');
  scene?.setLabelsVisible(mode === 'console');
  if (mode === 'console' && previousMode === 'opening') consoleTitle?.focus({ preventScroll: true });
  if (mode === 'hero' && previousMode === 'closing') enterButton?.focus({ preventScroll: true });
  previousMode = mode;
};

const modes = new ModeController(
  {
    onModeChange: applyMode,
    setIris: (radius, x, y) => {
      consoleLayer?.style.setProperty('--iris-r', `${radius.toFixed(1)}px`);
      consoleLayer?.style.setProperty('--iris-x', `${x.toFixed(0)}px`);
      consoleLayer?.style.setProperty('--iris-y', `${y.toFixed(0)}px`);
    },
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    reducedMotion,
  },
  parseMode(window.location),
);
loop.add((_dt, now) => modes.tick(now));

/** Where the iris opens: the pointer, or the button's centre for keyboard activation. */
const origin = (event: MouseEvent, el: HTMLElement) => {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
enterButton?.addEventListener('click', (event) => {
  const { x, y } = origin(event, enterButton);
  modes.open(x, y);
  history.replaceState(null, '', '#console');
});
backButton?.addEventListener('click', (event) => {
  const { x, y } = origin(event, backButton);
  modes.close(x, y);
  history.replaceState(null, '', window.location.pathname + window.location.search);
});

// ---- 3D scene ----
// Loads after first paint so the hero text never waits on WebGL.
const whenIdle = (fn: () => void): void => {
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 800 });
  else setTimeout(fn, 200);
};
const loadScene = () =>
  whenIdle(() => {
    import('./scene/mount.ts')
      .then(({ mountScene }) => mountScene({ sim, loop }))
      .then((handle) => {
        scene = handle;
        scene?.setFraming(modes.mode === 'hero' ? 'hero' : 'console', true);
        scene?.setLabelsVisible(modes.mode === 'console');
      })
      // A failed chunk load (e.g. a stale tab after a redeploy) leaves the static layout in place.
      .catch((error: unknown) => console.warn('[scene] not loaded', error));
  });

// With WebGL on the CPU (no GPU), wait for the visitor to engage before spending main-thread time
// on a decorative scene; with a GPU, load it straight away.
const ENGAGE = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const startScene = () => {
  if (!isSoftwareRenderer(webglRendererName())) return loadScene();
  const go = () => {
    ENGAGE.forEach((type) => window.removeEventListener(type, go));
    loadScene();
  };
  ENGAGE.forEach((type) => window.addEventListener(type, go, { passive: true }));
};
if (document.readyState === 'complete') startScene();
else window.addEventListener('load', startScene, { once: true });

// ?debug loads a plain-text simulator console below the hero. Code-split, so normal visitors never download it.
if (debug) {
  import('./debug/debug-view.ts')
    .then(({ mountDebugView }) => {
      const host = document.createElement('section');
      document.querySelector('main')?.append(host);
      mountDebugView(host, { sim, loop });
    })
    .catch((error: unknown) => console.warn('[debug] not loaded', error));
}
