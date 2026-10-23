import type { Loop } from '../app/loop.ts';
import type { Simulation } from '../sim/simulation.ts';
import type { Postmortem } from '../sim/types.ts';
import { createSparkline } from './sparkline.ts';
import {
  ACTIONS,
  budgetRing,
  burnText,
  chaosCards,
  dbText,
  formatClock,
  podsText,
  postmortemRows,
  SLO_CAPTION,
  timelineRows,
  type CardStatus,
} from './view-models.ts';

// The control room's panels. Built once with createElement/textContent, then refreshed a few
// times a second from the shared clock. Everything the 3D scene shows is also stated here.

const COLOURS = { accent: '#4cc9f0', ok: '#3ddc97', warn: '#f5a524', crit: '#ff4d5e' } as const;
const STATUS_TEXT: Record<CardStatus, string> = { ready: 'Ready', running: 'Running', cooldown: 'Cooling down', disabled: 'Unavailable' };
const ALERT_TEXT = { inactive: '✓ ok', pending: '◔ pending', firing: '● firing' } as const;
const SEVERITY_ICON = { info: '·', ok: '✓', warn: '▲', crit: '●' } as const;
const CAPTION_SOURCES = new Set(['chaos', 'alertmanager', 'hpa', 'db']);
const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, tour?: string): HTMLElement {
  const block = el('section', 'block');
  if (tour) block.dataset.tour = tour;
  block.append(el('h4', 'block-title', title));
  return block;
}

export interface ConsoleRegions {
  chaos: HTMLElement;
  metrics: HTMLElement;
  timeline: HTMLElement;
  viewport: HTMLElement;
}

export function mountConsole(regions: ConsoleRegions, { sim, loop }: { sim: Simulation; loop: Loop }): () => void {
  // ---- Chaos console ----
  let lastKillAt: number | null = null;
  const cards = new Map<string, { button: HTMLButtonElement; state: HTMLElement; bar: HTMLElement }>();
  const actions = el('div', 'actions');
  for (const action of ACTIONS) {
    const button = el('button', 'action');
    button.type = 'button';
    button.dataset.action = action.id;
    button.dataset.tour = `action-${action.id}`;
    const state = el('span', 'action-state', 'Ready');
    const bar = el('span', 'action-bar');
    const progress = el('span', 'action-progress');
    progress.append(bar);
    button.append(
      el('span', 'action-glyph', action.glyph),
      el('span', 'action-title', action.title),
      el('span', 'action-detail', action.detail),
      state,
      progress,
    );
    button.addEventListener('click', () => sim.dispatch(action.command));
    actions.append(button);
    cards.set(action.id, { button, state, bar });
  }

  const controls = el('div', 'controls');
  const recover = el('button', 'btn-ghost', 'Recover all');
  recover.type = 'button';
  recover.dataset.tour = 'recover';
  recover.addEventListener('click', () => sim.dispatch({ type: 'recoverAll' }));
  const speed = el('div', 'speed');
  speed.setAttribute('role', 'group');
  speed.setAttribute('aria-label', 'Simulation speed');
  const speedButtons = ([1, 5] as const).map((s) => {
    const b = el('button', 'speed-btn', `${s}×`);
    b.type = 'button';
    b.addEventListener('click', () => sim.dispatch({ type: 'setSpeed', speed: s }));
    speed.append(b);
    return { s, b };
  });
  const reset = el('button', 'btn-ghost', 'Reset');
  reset.type = 'button';
  reset.addEventListener('click', () => sim.dispatch({ type: 'reset' }));
  controls.append(recover, speed, reset);
  regions.chaos.append(actions, controls);

  // ---- Service health ----
  const slo = section('Error budget', 'slo');
  const ring = el('div', 'ring');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(SVG, 'circle');
  const value = document.createElementNS(SVG, 'circle');
  for (const c of [track, value]) {
    c.setAttribute('cx', '40');
    c.setAttribute('cy', '40');
    c.setAttribute('r', '34');
    svg.append(c);
  }
  track.setAttribute('class', 'ring-track');
  value.setAttribute('class', 'ring-value');
  const circumference = 2 * Math.PI * 34;
  value.setAttribute('stroke-dasharray', circumference.toFixed(2));
  const ringPct = el('span', 'ring-pct', '100%');
  ring.append(svg, ringPct);
  const sloCaption = el('p', 'block-note', SLO_CAPTION);
  const burn = el('p', 'block-line');
  slo.append(ring, sloCaption, burn);

  const signals = section('Signals', 'signals');
  interface SignalDef {
    key: 'rps' | 'p99' | 'errorRatio' | 'cpu';
    label: string;
    unit: (v: number) => string;
    tone: (v: number) => string;
  }
  const signalDefs: SignalDef[] = [
    { key: 'rps', label: 'Requests', unit: (v) => `${Math.round(v)} rps`, tone: () => COLOURS.accent },
    { key: 'p99', label: 'p99 latency', unit: (v) => `${Math.round(v)} ms`, tone: (v) => (v > 1_000 ? COLOURS.crit : v > 300 ? COLOURS.warn : COLOURS.accent) },
    { key: 'errorRatio', label: 'Errors', unit: (v) => `${(v * 100).toFixed(2)}%`, tone: (v) => (v > 0.01 ? COLOURS.crit : v > 0.001 ? COLOURS.warn : COLOURS.accent) },
    { key: 'cpu', label: 'CPU (of request)', unit: (v) => `${Math.round(v * 100)}%`, tone: (v) => (v > 1.2 ? COLOURS.crit : v > 0.66 ? COLOURS.warn : COLOURS.accent) },
  ];
  const series = signalDefs.map((s) => ({ ...s, spark: createSparkline(s.label), value: el('span', 'signal-value', '–') }));
  const signalList = el('ul', 'signals');
  for (const s of series) {
    const li = el('li', 'signal');
    li.append(el('span', 'signal-label', s.label), s.value, s.spark.canvas);
    signalList.append(li);
  }
  signals.append(signalList);

  const podsBlock = section('checkout-api', 'pods');
  const pods = el('p', 'block-line');
  const hold = el('p', 'block-note');
  podsBlock.append(pods, hold);

  const dbBlock = section('Postgres', 'db');
  const db = el('p', 'block-line pre');
  dbBlock.append(db);

  const alertsBlock = section('Alerts', 'alerts');
  const alertList = el('ul', 'alerts');
  const alertRows = new Map<string, { li: HTMLElement; chip: HTMLElement }>();
  for (const alert of sim.state.alerts) {
    const li = el('li', 'alert');
    const chip = el('span', 'chip', ALERT_TEXT.inactive);
    li.append(chip, el('span', 'alert-name', alert.name), el('span', 'alert-sev', alert.severity));
    alertList.append(li);
    alertRows.set(alert.name, { li, chip });
  }
  alertsBlock.append(alertList);
  regions.metrics.append(slo, signals, podsBlock, dbBlock, alertsBlock);

  // ---- Timeline, captions, live announcements ----
  const timeline = el('ol', 'timeline');
  timeline.dataset.tour = 'timeline';
  regions.timeline.append(timeline);
  const live = el('div', 'sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const captions = el('div', 'captions');
  captions.setAttribute('aria-hidden', 'true');
  regions.viewport.append(captions);
  document.body.append(live);

  const caption = (source: string, text: string) => {
    const c = el('p', 'caption');
    c.append(el('span', 'caption-source', source), document.createTextNode(text));
    captions.prepend(c);
    while (captions.childElementCount > 3) captions.lastElementChild?.remove();
    setTimeout(() => c.classList.add('caption-out'), 3_600);
    setTimeout(() => c.remove(), 4_200);
  };

  // ---- Postmortem card ----
  const card = el('section', 'postmortem');
  card.hidden = true;
  card.setAttribute('aria-labelledby', 'postmortem-title');
  card.dataset.tour = 'postmortem';
  const cardTitle = el('h3', undefined, 'Postmortem');
  cardTitle.id = 'postmortem-title';
  const list = el('dl');
  const dismiss = el('button', 'btn-ghost', 'Dismiss');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => (card.hidden = true));
  card.append(cardTitle, list, dismiss);
  regions.viewport.append(card);
  const showPostmortem = (pm: Postmortem) => {
    list.replaceChildren(...postmortemRows(pm).flatMap(([k, v]) => [el('dt', undefined, k), el('dd', undefined, v)]));
    card.hidden = false;
  };

  const unsubscribe = [
    sim.bus.on('chaosStarted', (e) => {
      if (e.run.kind === 'killPod') lastKillAt = e.t;
    }),
    sim.bus.on('timelineEvent', ({ entry }) => {
      if (CAPTION_SOURCES.has(entry.source)) caption(entry.source, entry.message);
      if (entry.source === 'alertmanager') live.textContent = entry.message;
    }),
    sim.bus.on('postmortemReady', ({ postmortem }) => {
      showPostmortem(postmortem);
      live.textContent = `Incident resolved. Postmortem: time to recover ${formatClock(postmortem.timeToRecoverMs)}.`;
    }),
    sim.bus.on('reset', () => {
      lastKillAt = null;
      card.hidden = true;
      captions.replaceChildren();
    }),
  ];

  // ---- Refresh from the shared clock ----
  let lastDraw = Number.NEGATIVE_INFINITY;
  let lastSeq = -1;
  const off = loop.add((_dt, now) => {
    if (now - lastDraw < 250) return;
    lastDraw = now;
    const state = sim.state;

    for (const c of chaosCards(state, lastKillAt)) {
      const view = cards.get(c.id)!;
      view.button.dataset.status = c.status;
      view.button.disabled = c.status === 'running' || c.status === 'cooldown' || c.status === 'disabled';
      view.state.textContent = STATUS_TEXT[c.status];
      view.bar.style.transform = `scaleX(${c.remaining.toFixed(3)})`;
    }
    speedButtons.forEach(({ s, b }) => b.setAttribute('aria-pressed', String(sim.speed === s)));

    const budget = budgetRing(state.slo.budgetRemaining);
    value.setAttribute('stroke-dashoffset', (circumference * (1 - budget.fraction)).toFixed(2));
    ring.dataset.tone = budget.tone;
    ringPct.textContent = budget.pct;
    burn.textContent = burnText(state.slo);

    const points = state.metrics.series.slice(-120);
    for (const s of series) {
      const values = points.map((p) => p[s.key]);
      const latest = values.at(-1);
      s.value.textContent = latest === undefined ? '–' : s.unit(latest);
      s.spark.draw(values, latest === undefined ? COLOURS.accent : s.tone(latest));
    }

    const p = podsText(state);
    pods.textContent = p.text;
    hold.textContent = p.hold ?? '';
    db.textContent = dbText(state);

    for (const alert of state.alerts) {
      const row = alertRows.get(alert.name)!;
      row.li.dataset.state = alert.state;
      row.chip.textContent = ALERT_TEXT[alert.state];
    }

    const newest = state.timeline.at(-1)?.seq ?? -1;
    if (newest !== lastSeq) {
      lastSeq = newest;
      timeline.replaceChildren(
        ...timelineRows(state.timeline, 40).map((e) => {
          const li = el('li', `row sev-${e.severity}`);
          li.append(el('span', 'row-time', formatClock(e.t)), el('span', 'row-icon', SEVERITY_ICON[e.severity]), el('span', 'row-source', e.source), el('span', 'row-message', e.message));
          return li;
        }),
      );
    }
  });

  return () => {
    off();
    unsubscribe.forEach((u) => u());
    live.remove();
  };
}
