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
import { getMotion, provideMotion } from './motion/ready.ts';
import { Simulation } from './sim/simulation.ts';
import type { Command } from './sim/types.ts';
import { DURATION, EASE, STAGGER } from './motion/presets.ts';
import { mountBootRing } from './ui/boot-ring.ts';
import { mountConsole } from './ui/console.ts';
import { clearInline, el } from './ui/dom.ts';
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
// The strip at the top and the footer's status line.
mountStatusStrip([...document.querySelectorAll<HTMLElement>('[data-testid="status"], [data-footer-status]')], { sim, loop });
loop.start();

const debug = new URLSearchParams(window.location.search).has('debug');
if (debug) {
  const motionState = () => {
    const registry = getMotion()?.registry;
    return registry ? { loaded: true, paused: registry.paused, active: registry.active, reduced: registry.reduced } : { loaded: false };
  };
  (window as unknown as { __ccr?: unknown }).__ccr = { sim, motion: motionState };
}

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

/** Console panels cascade in while the iris opens (no-op until the motion engine is loaded). */
const cascadeConsole = () => {
  const motionApi = getMotion();
  const panels = [...document.querySelectorAll<HTMLElement>('.console-header, .console .panel')];
  // Movement only: panels stay fully opaque, so their text never dips below contrast mid-entrance.
  motionApi?.animate(panels, {
    translateY: [14, 0],
    duration: DURATION.enter,
    ease: EASE.enter,
    delay: motionApi.stagger(STAGGER.panel, { start: 120 }),
    onComplete: () => clearInline(panels, ['transform']),
  });
};

const applyMode = (mode: Mode) => {
  document.body.dataset.mode = mode;
  if (hero) hero.inert = mode === 'console';
  if (consoleLayer) consoleLayer.inert = mode === 'hero';
  syncScene(mode);
  if (mode === 'opening') cascadeConsole();
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
  if (modes.mode === 'closing') {
    // Mid-close: finish closing, and don't leave a #tour URL behind for the next reload.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  tourOpener = from;
  if (modes.mode === 'hero') openConsole(event, from, 'tour');
  else pendingFocus = 'tour'; // opening: start once the iris is done
};

/** A scenario link opens the console and starts its experiment a beat later, so the visitor sees it begin. */
const SCENARIO_DELAY_MS = 1_200;
const runScenario = (command: Command) => {
  history.replaceState(history.state, '', '#console'); // run once: Back/Forward or a reload won't repeat it
  if (modes.mode === 'hero') openConsole(null);
  sim.dispatchAfter(SCENARIO_DELAY_MS, command);
};
const closeConsole = (event: MouseEvent | null) => {
  const { x, y } = origin(event, backButton);
  pendingFocus = 'hero';
  modes.close(x, y);
};

// The console is a history entry: Enter pushes #console, browser Back (or ← Overview) returns.
enterButton?.addEventListener('click', (event) => {
  if (modes.mode !== 'hero') return;
  history.pushState({ ccr: 'console' }, '', '#console');
  openConsole(event);
});
// Tour buttons, and the footer's #tour / #console links, which take the same history path as the
// buttons (a plain fragment link would leave an entry that ← Overview can't step back over).
document.querySelectorAll<HTMLElement>('[data-tour-start], a[href="#tour"]').forEach((trigger) =>
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    if (modes.mode === 'closing') return;
    if (modes.mode === 'hero') history.pushState({ ccr: 'console' }, '', '#tour');
    else history.replaceState(history.state, '', '#tour');
    startTour(event, trigger);
  }),
);
document.querySelectorAll<HTMLAnchorElement>('a[href="#console"]').forEach((link) =>
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (modes.mode !== 'hero') return;
    history.pushState({ ccr: 'console' }, '', '#console');
    openConsole(event, link);
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

mountBootRing(document.body, { sim, loop, reducedMotion });

// "Pause motion" in the status strip, on every view (WCAG 2.2.2); the console has its own button too.
const motionToggles = [...document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')];
motionToggles.forEach((b) => b.addEventListener('click', () => motion.set(!motion.paused)));
motion.subscribe((paused) => motionToggles.forEach((b) => b.setAttribute('aria-pressed', String(paused))));

// ---- Motion engine ----
// anime.js arrives in its own chunk once the page is idle. Until then (or if it never loads)
// everything that would animate simply shows its end state.
whenIdle(() => {
  import('./motion/engine.ts')
    .then(({ startMotion }) => {
      const api = startMotion({ loop, reducedMotion });
      provideMotion(api);
      // A preference changed mid-visit applies at once: running animations jump to their end.
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => api.registry.setReduced(e.matches));
    })
    .catch((error: unknown) => console.warn('[motion] not loaded', error));
});

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
