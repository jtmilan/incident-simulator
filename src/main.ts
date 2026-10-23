import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';

import { createLoop } from './app/loop.ts';
import { goatCounterCode, injectGoatCounter } from './config/analytics.ts';
import { getBuildInfo } from './config/build-info.ts';
import { Simulation } from './sim/simulation.ts';

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

// One simulator and one clock for everything on the page.
const sim = new Simulation({ seed: 1 });
const loop = createLoop();
loop.add((dt) => sim.advance(dt));
// The clock runs only once something shows the simulation (the scene, or the ?debug console).

const debug = new URLSearchParams(window.location.search).has('debug');
if (debug) (window as unknown as { __ccr?: { sim: Simulation } }).__ccr = { sim };

// The 3D scene loads after first paint so the hero text is never waiting on WebGL.
const whenIdle = (fn: () => void): void => {
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 800 });
  else setTimeout(fn, 200);
};
const loadScene = () =>
  whenIdle(() => {
    import('./scene/mount.ts')
      .then(({ mountScene }) => {
        if (mountScene({ sim, loop })) loop.start();
      })
      // A failed chunk load (e.g. a stale tab after a redeploy) leaves the static layout in place.
      .catch((error: unknown) => console.warn('[scene] not loaded', error));
  });
if (document.readyState === 'complete') loadScene();
else window.addEventListener('load', loadScene, { once: true });

// ?debug loads a plain-text simulator console below the hero. Code-split, so normal visitors never download it.
if (debug) {
  import('./debug/debug-view.ts')
    .then(({ mountDebugView }) => {
      const host = document.createElement('section');
      document.querySelector('main')?.append(host);
      mountDebugView(host, { sim, loop });
      loop.start();
    })
    .catch((error: unknown) => console.warn('[debug] not loaded', error));
}
