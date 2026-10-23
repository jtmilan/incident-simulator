import { Simulation } from '../sim/simulation.ts';
import type { Command, SimState } from '../sim/types.ts';
import './debug.css';

// A plain-text window into the simulator, loaded only with ?debug. It is a verification aid for
// the live site, not the product UI: every value is written with textContent.

const CONTROLS: { id: string; label: string; command: Command }[] = [
  { id: 'killPod', label: 'Kill pod', command: { type: 'killPod' } },
  { id: 'injectErrors', label: 'Inject 5xx (5%, 30 s)', command: { type: 'injectErrors', ratio: 0.05, durationMs: 30_000 } },
  { id: 'trafficSurge', label: 'Traffic surge (×3, 60 s)', command: { type: 'trafficSurge', multiplier: 3, durationMs: 60_000 } },
  { id: 'injectLatency', label: 'Inject latency (+400 ms, 45 s)', command: { type: 'injectLatency', ms: 400, durationMs: 45_000 } },
  { id: 'failoverDatabase', label: 'Fail over DB', command: { type: 'failoverDatabase' } },
  { id: 'recoverAll', label: 'Recover all', command: { type: 'recoverAll' } },
  { id: 'speed-1', label: '1×', command: { type: 'setSpeed', speed: 1 } },
  { id: 'speed-5', label: '5×', command: { type: 'setSpeed', speed: 5 } },
  { id: 'reset', label: 'Reset', command: { type: 'reset' } },
];

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title: string, testId: string): { section: HTMLElement; body: HTMLPreElement } {
  const section = el('section', 'debug-panel');
  section.append(el('h3', undefined, title));
  const body = el('pre');
  body.dataset.testid = testId;
  section.append(body);
  return { section, body };
}

function summarize(state: Readonly<SimState>, sim: Simulation) {
  const m = sim.latest;
  const pods = state.pods
    .map((p) => `${p.id.padEnd(36)} ${p.status.padEnd(17)} ${p.nodeId ?? '-'}`)
    .join('\n');
  const metrics = m
    ? [
        `rps     ${m.rps.toFixed(0)}`,
        `cpu     ${pct(m.cpu, 0)} of request (HPA target 60%)`,
        `latency p50 ${m.p50.toFixed(0)} ms · p95 ${m.p95.toFixed(0)} ms · p99 ${m.p99.toFixed(0)} ms`,
        `errors  ${pct(m.errorRatio, 2)}`,
        `pods    ${m.readyPods} ready / ${state.deployment.desiredReplicas} desired` +
          (state.hpa.scaleDownHoldUntil ? ` · scale-down held ${clock(state.hpa.scaleDownHoldUntil - state.t)}` : ''),
      ].join('\n')
    : 'warming up…';
  const slo = [
    `SLO ${pct(state.slo.target)} · window ${'30d → 1h (demo)'}`,
    `budget remaining ${pct(state.slo.budgetRemaining)}`,
    `burn ${state.slo.burnLong.toFixed(1)}× (60 s) · ${state.slo.burnShort.toFixed(1)}× (5 s) · page at 14.4×`,
    ...state.alerts.map((a) => `${a.state.toUpperCase().padEnd(8)} ${a.name} [${a.severity}]`),
  ].join('\n');
  const db = [
    `phase ${state.db.phase}`,
    ...state.db.instances.map((i) => `${i.id} zone-${i.zone} ${i.role.padEnd(7)} ${i.up ? 'up' : 'DOWN'}`),
    `writes failing ${pct(state.db.writeFailureRatio, 0)} · lag ${state.db.replicationLagMs.toFixed(0)} ms · pool ${state.db.pool.active}/${state.db.pool.max}`,
  ].join('\n');
  const pm = state.lastPostmortem;
  const postmortem = pm
    ? [
        `chaos ${pm.chaos.join(', ')}`,
        `time to detect ${pm.timeToDetectMs === null ? 'not paged (self-healed)' : clock(pm.timeToDetectMs)}`,
        `time to recover ${clock(pm.timeToRecoverMs)}`,
        `budget burned ${pct(pm.budgetBurned)} · peak errors ${pct(pm.peakErrorRatio, 2)} · peak p99 ${pm.peakP99.toFixed(0)} ms`,
        `alerts ${pm.alertsFired.join(', ') || 'none'}`,
      ].join('\n')
    : 'no incident yet';
  return { pods, metrics, slo, db, postmortem };
}

export function mountDebugView(host: HTMLElement): () => void {
  const sim = new Simulation({ seed: 1 });
  host.className = 'debug-view';
  host.dataset.testid = 'debug-view';
  host.append(el('h2', undefined, 'Simulator debug view'));

  const header = el('p', 'debug-meta');
  header.dataset.testid = 'debug-clock';
  host.append(header);

  const controls = el('div', 'debug-controls');
  for (const control of CONTROLS) {
    const button = el('button', undefined, control.label);
    button.type = 'button';
    button.dataset.testid = `cmd-${control.id}`;
    button.addEventListener('click', () => sim.dispatch(control.command));
    controls.append(button);
  }
  host.append(controls);

  const grid = el('div', 'debug-grid');
  const pods = panel('Pods', 'debug-pods');
  const metrics = panel('Metrics', 'debug-metrics');
  const slo = panel('SLO & alerts', 'debug-slo');
  const db = panel('Database', 'debug-db');
  const postmortem = panel('Last postmortem', 'debug-postmortem');
  const timelineSection = el('section', 'debug-panel debug-timeline');
  timelineSection.append(el('h3', undefined, 'Timeline'));
  const timeline = el('ol');
  timeline.dataset.testid = 'debug-timeline';
  timelineSection.append(timeline);
  grid.append(pods.section, metrics.section, slo.section, db.section, postmortem.section, timelineSection);
  host.append(grid);

  const render = () => {
    const state = sim.state;
    const text = summarize(state, sim);
    header.textContent = `sim time ${clock(state.t)} · speed ${sim.speed}× · seed ${state.seed}`;
    pods.body.textContent = text.pods;
    metrics.body.textContent = text.metrics;
    slo.body.textContent = text.slo;
    db.body.textContent = text.db;
    postmortem.body.textContent = text.postmortem;
    timeline.replaceChildren(
      ...state.timeline.slice(-15).reverse().map((e) => {
        const li = el('li', `sev-${e.severity}`, `${clock(e.t)}  ${e.source.padEnd(12)} ${e.message}`);
        return li;
      }),
    );
  };

  let last = performance.now();
  let lastRender = 0;
  let frame = 0;
  const loop = (now: number) => {
    sim.advance(now - last);
    last = now;
    if (now - lastRender >= 250) {
      render();
      lastRender = now;
    }
    frame = requestAnimationFrame(loop);
  };
  const onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(frame);
    else {
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  render();
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisibility);
    host.replaceChildren();
  };
}
