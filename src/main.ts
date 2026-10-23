import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';

import { goatCounterCode, injectGoatCounter } from './config/analytics.ts';
import { getBuildInfo } from './config/build-info.ts';

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
