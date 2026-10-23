import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/hero.css';
import './styles/console.css';
import './styles/tour.css';

import { isSoftwareRenderer, webglRendererName } from './app/gpu.ts';
import { createLoop } from './app/loop.ts';
import { motion } from './app/motion.ts';
import { goatCounterCode, injectGoatCounter } from './config/analytics.ts';
import { getBuildInfo } from './config/build-info.ts';
import type { SceneHandle } from './scene/mount.ts';
import { Simulation } from './sim/simulation.ts';
import type { Command } from './sim/types.ts';
import { mountConsole } from './ui/console.ts';
import { el } from './ui/dom.ts';
import { mountHeadline } from './ui/headline.ts';
import { mountMobileTabs, type MobileTabs } from './ui/mobile-tabs.ts';
import { ModeController, parseMode, type Mode } from './ui/modes.ts';
import { INFRA_MAP } from './ui/real-config.ts';
import { parseDeepLink } from './ui/scenarios.ts';
import { mountStatusStrip } from './ui/status-strip.ts';
import { createTour } from './ui/tour.ts';

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
loop.add((dt) => {
  if (!motion.paused) sim.advance(dt);
});
const statusRoot = document.querySelector<HTMLElement>('[data-testid="status"]');
if (statusRoot) mountStatusStrip(statusRoot, { sim, loop });
const footerStatus = document.querySelector<HTMLElement>('[data-footer-status]');
if (footerStatus) mountStatusStrip(footerStatus, { sim, loop });
loop.start();

const debug = new URLSearchParams(window.location.search).has('debug');
if (debug) (window as unknown as { __ccr?: { sim: Simulation } }).__ccr = { sim };

const headline = document.querySelector<HTMLElement>('[data-headline]');
if (headline) mountHeadline(headline);

const infraMap = document.querySelector<HTMLElement>('[data-infra-map]');
infraMap?.replaceChildren(
  ...INFRA_MAP.map(({ part, real }) => {
    const row = el('div', 'infra-row');
    row.append(el('dt', undefined, part), el('dd', undefined, real));
    return row;
  }),
);

// ---- Console panels ----
const region = (name: string) => document.querySelector<HTMLElement>(`[data-region="${name}"]`);
const chaosRegion = region('chaos');
const metricsRegion = region('metrics');
const timelineRegion = region('timeline');
const viewportRegion = region('viewport');
let tabs: MobileTabs | null = null;
if (chaosRegion && metricsRegion && timelineRegion && viewportRegion) {
  mountConsole({ chaos: chaosRegion, metrics: metricsRegion, timeline: timelineRegion, viewport: viewportRegion }, { sim, loop });
  const grid = document.querySelector<HTMLElement>('.console-grid');
  if (grid) {
    tabs = mountMobileTabs(grid, [
      { id: 'chaos', label: 'Chaos', panel: chaosRegion },
      { id: 'health', label: 'Health', panel: metricsRegion },
      { id: 'timeline', label: 'Timeline', panel: timelineRegion },
    ]);
  }
}

// ---- Hero ⇄ console ----
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = document.querySelector<HTMLElement>('.hero');
const consoleLayer = document.querySelector<HTMLElement>('.console');
const consoleTitle = document.querySelector<HTMLElement>('#console-title');
const enterButton = document.querySelector<HTMLButtonElement>('[data-enter]');
const backButton = document.querySelector<HTMLButtonElement>('[data-back]');
const consoleTourButton = document.querySelector<HTMLButtonElement>('[data-console-tour]');
let scene: SceneHandle | null = null;
// What happens once a user-initiated switch completes (with or without the iris): focus the
// console, focus the hero, or start the guided tour.
let pendingFocus: 'console' | 'hero' | 'tour' | null = null;
let tourOpener: HTMLElement | null = null;

const tour = createTour({
  sim,
  loop,
  reducedMotion,
  reveal: (target) => tabs?.reveal(target),
  fallbackFocus: () => consoleTourButton ?? consoleTitle,
  onEnd: () => {
    // Leave the plain console URL behind, so a reload doesn't restart the tour.
    if (window.location.hash === '#tour') history.replaceState(history.state, '', '#console');
  },
});

/** One rule for camera framing and labels, used by mode changes and by a late-loading scene. */
const framingFor = (mode: Mode): 'hero' | 'console' => (mode === 'opening' || mode === 'console' ? 'console' : 'hero');
const syncScene = (mode: Mode, immediate = false) => {
  scene?.setFraming(framingFor(mode), immediate);
  scene?.setLabelsVisible(mode === 'console');
};

const applyMode = (mode: Mode) => {
  document.body.dataset.mode = mode;
  if (hero) hero.inert = mode === 'console';
  if (consoleLayer) consoleLayer.inert = mode === 'hero';
  syncScene(mode);
  if (mode === 'closing' || mode === 'hero') tour.end(false);
  if (mode === 'console' && pendingFocus === 'console') consoleTitle?.focus({ preventScroll: true });
  if (mode === 'console' && pendingFocus === 'tour') tour.start(tourOpener);
  if (mode === 'hero' && pendingFocus === 'hero') enterButton?.focus({ preventScroll: true });
  if (mode === 'console' || mode === 'hero') pendingFocus = null;
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
const origin = (event: MouseEvent | null, el: HTMLElement | null) => {
  if (event && event.detail > 0) return { x: event.clientX, y: event.clientY };
  const rect = el?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
};
const openConsole = (event: MouseEvent | null, from: HTMLElement | null = enterButton, then: 'console' | 'tour' = 'console') => {
  const { x, y } = origin(event, from);
  pendingFocus = then;
  modes.open(x, y);
};

/** The tour runs in the console: restart it there, or open the console and start once the iris is done. */
const startTour = (event: MouseEvent | null, from: HTMLElement | null) => {
  if (modes.mode === 'console') return tour.start(from);
  tourOpener = from;
  if (modes.mode === 'hero') openConsole(event, from, 'tour');
  else if (modes.mode === 'opening') pendingFocus = 'tour';
};

/** A scenario link opens the console and starts its experiment a beat later, so the visitor sees it begin. */
const SCENARIO_DELAY_MS = 1_200;
const runScenario = (command: Command) => {
  history.replaceState(history.state, '', '#console'); // run once: Back/Forward or a reload won't repeat it
  if (modes.mode === 'hero') openConsole(null);
  sim.schedule(sim.state.t + SCENARIO_DELAY_MS, command);
};
const closeConsole = (event: MouseEvent | null) => {
  const { x, y } = origin(event, backButton);
  pendingFocus = 'hero';
  modes.close(x, y);
};

// The console is a history entry: Enter pushes #console, browser Back (or ← Overview) returns.
enterButton?.addEventListener('click', (event) => {
  history.pushState({ ccr: 'console' }, '', '#console');
  openConsole(event);
});
document.querySelectorAll<HTMLButtonElement>('[data-tour-start]').forEach((button) =>
  button.addEventListener('click', (event) => {
    if (modes.mode === 'hero') history.pushState({ ccr: 'console' }, '', '#tour');
    else history.replaceState(history.state, '', '#tour');
    startTour(event, button);
  }),
);
backButton?.addEventListener('click', (event) => {
  if ((history.state as { ccr?: string } | null)?.ccr === 'console') history.back();
  else history.replaceState(null, '', window.location.pathname + window.location.search);
  closeConsole(event);
});
const followLocation = () => {
  const link = parseDeepLink(window.location.hash);
  if (link?.kind === 'tour') {
    if (!tour.running) startTour(null, null);
    return;
  }
  if (link?.kind === 'scenario') return runScenario(link.command);
  const wanted = parseMode(window.location);
  if (wanted === 'console' && modes.mode === 'hero') openConsole(null);
  if (wanted === 'hero' && modes.mode === 'console') closeConsole(null);
};
window.addEventListener('popstate', followLocation);
window.addEventListener('hashchange', followLocation);
followLocation(); // #tour and #scenario=… links on arrival

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
        syncScene(modes.mode, true);
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
      // Floating, so it stays usable in console mode (where the hero is hidden and inert).
      const host = document.createElement('section');
      host.classList.add('debug-floating');
      document.body.append(host);
      mountDebugView(host, { sim, loop });
    })
    .catch((error: unknown) => console.warn('[debug] not loaded', error));
}
