import type { Loop } from '../app/loop.ts';
import { clearInline, el } from './dom.ts';
import { motion } from '../app/motion.ts';
import type { Simulation } from '../sim/simulation.ts';
import { HEALTHY_ERROR_RATIO, HEALTHY_P99_MS } from '../sim/config.ts';
import type { Postmortem, TimelineEvent } from '../sim/types.ts';
import { DURATION, EASE, STAGGER, dialChange, dialTicks } from '../motion/presets.ts';
import { getMotion } from '../motion/ready.ts';
import { configButton, createConfigDialog, type ConfigKey } from './config-dialog.ts';
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
/** Ticks on the error-budget dial. */
const DIAL_TICKS = 60;


let openConfig: ((key: ConfigKey, opener: HTMLElement) => void) | null = null;

/** A "</> real config" button that opens the manifests behind a panel. */
function realConfig(key: ConfigKey): HTMLButtonElement {
  const button = configButton();
  button.dataset.config = key;
  button.addEventListener('click', () => {
    openConfig ??= createConfigDialog();
    openConfig(key, button);
  });
  return button;
}

function section(title: string, tour?: string, config?: ConfigKey): HTMLElement {
  const block = el('section', 'block');
  if (tour) block.dataset.tour = tour;
  const heading = el('div', 'block-head');
  heading.append(el('h4', 'block-title', title));
  if (config) heading.append(realConfig(config));
  block.append(heading);
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
  actions.dataset.tour = 'actions';
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
    // aria-disabled rather than disabled: a busy card keeps keyboard focus and still says why.
    button.addEventListener('click', () => {
      // Check the live state, not the last 250 ms refresh, so a double-click can't queue two runs.
      const card = chaosCards(sim.state, lastKillAt).find((c) => c.id === action.id);
      if (button.getAttribute('aria-disabled') === 'true' || card?.status !== 'ready') return;
      sim.dispatch(action.command);
      if (action.id === 'killPod') lastKillAt = sim.state.t;
      button.setAttribute('aria-disabled', 'true'); // until the next refresh shows the run
      // Spring press: the CSS transform transition is off while it runs, and the inline transform
      // is cleared afterwards so the hover lift works again.
      const motionApi = getMotion();
      if (motionApi) {
        button.style.transition = 'none';
        motionApi.animate(button, { scale: [0.97, 1], ease: motionApi.press, onComplete: () => clearInline([button], ['transform', 'transition']) });
      }
    });
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
  const pause = el('button', 'btn-ghost', 'Pause motion');
  pause.type = 'button';
  pause.setAttribute('aria-pressed', 'false');
  pause.addEventListener('click', () => motion.set(!motion.paused));
  const offPause = motion.subscribe((paused) => pause.setAttribute('aria-pressed', String(paused)));
  controls.append(recover, speed, pause, reset);
  const chaosFooter = el('div', 'panel-foot');
  chaosFooter.append(realConfig('workload'));
  regions.chaos.append(actions, controls, chaosFooter);

  // ---- Service health ----
  const slo = section('Error budget', 'slo', 'slo');
  const ring = el('div', 'ring');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('aria-hidden', 'true');
  // A dial of ticks: lit ticks are the budget left, and they switch off as it burns.
  const ticks = Array.from({ length: DIAL_TICKS }, (_, i) => {
    const angle = (i / DIAL_TICKS) * 2 * Math.PI;
    const line = document.createElementNS(SVG, 'line');
    // Quarter marks reach further in, like a gauge.
    const inner = i % (DIAL_TICKS / 4) === 0 ? 25 : 29;
    line.setAttribute('x1', (40 + inner * Math.cos(angle)).toFixed(2));
    line.setAttribute('y1', (40 + inner * Math.sin(angle)).toFixed(2));
    line.setAttribute('x2', (40 + 37 * Math.cos(angle)).toFixed(2));
    line.setAttribute('y2', (40 + 37 * Math.sin(angle)).toFixed(2));
    line.setAttribute('class', 'dial-tick');
    line.dataset.lit = 'true';
    svg.append(line);
    return line;
  });
  let litTicks = DIAL_TICKS;
  const ringPct = el('span', 'ring-pct', '100%');
  ring.append(svg, ringPct);
  const sloCaption = el('p', 'block-note', SLO_CAPTION);
  const burn = el('p', 'block-line');
  slo.append(ring, sloCaption, burn);

  const signals = section('Signals', 'signals', 'promql');
  interface SignalDef {
    key: 'rps' | 'p99' | 'errorRatio' | 'cpu';
    label: string;
    unit: (v: number) => string;
    tone: (v: number) => string;
  }
  const signalDefs: SignalDef[] = [
    { key: 'rps', label: 'Requests', unit: (v) => `${Math.round(v)} rps`, tone: () => COLOURS.accent },
    { key: 'p99', label: 'p99 latency', unit: (v) => `${Math.round(v)} ms`, tone: (v) => (v > 1_000 ? COLOURS.crit : v > HEALTHY_P99_MS ? COLOURS.warn : COLOURS.accent) },
    { key: 'errorRatio', label: 'Errors', unit: (v) => `${(v * 100).toFixed(2)}%`, tone: (v) => (v > 0.01 ? COLOURS.crit : v > HEALTHY_ERROR_RATIO ? COLOURS.warn : COLOURS.accent) },
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

  const dbBlock = section('Postgres', 'db', 'database');
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
      if (!CAPTION_SOURCES.has(entry.source)) return;
      caption(entry.source, entry.message);
      // Status messages for screen readers; alerts take priority over chaos/DB/HPA lines.
      if (entry.source === 'alertmanager' || pendingAnnouncement === null || !pendingAnnouncement.startsWith('FIRING')) {
        pendingAnnouncement = entry.message;
      }
    }),
    // A new incident retires the last postmortem card.
    sim.bus.on('incidentOpened', () => (card.hidden = true)),
    sim.bus.on('postmortemReady', ({ postmortem }) => {
      showPostmortem(postmortem);
      live.textContent = `Incident resolved. Postmortem: time to recover ${formatClock(postmortem.timeToRecoverMs)}.`;
    }),
    sim.bus.on('reset', () => {
      // Timeline seq restarts at 0: redraw from scratch on the next refresh.
      lastSeq = -1;
      timeline.replaceChildren();
      lastKillAt = null;
      card.hidden = true;
      captions.replaceChildren();
    }),
  ];

  const ROWS = 40;
  const row = (e: TimelineEvent) => {
    const li = el('li', `row sev-${e.severity}`);
    li.append(el('span', 'row-time', formatClock(e.t)), el('span', 'row-icon', SEVERITY_ICON[e.severity]), el('span', 'row-source', e.source), el('span', 'row-message', e.message));
    return li;
  };

  // ---- Refresh from the shared clock ----
  let pendingAnnouncement: string | null = null;
  let lastAnnounce = Number.NEGATIVE_INFINITY;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let lastSeq = -1;
  const off = loop.add((_dt, now) => {
    // Nothing to draw while the console layer is hidden behind the hero.
    if (now - lastDraw < 250 || document.body.dataset.mode === 'hero') return;
    lastDraw = now;
    const state = sim.state;
    if (pendingAnnouncement !== null && now - lastAnnounce >= 1_500) {
      live.textContent = pendingAnnouncement;
      pendingAnnouncement = null;
      lastAnnounce = now;
    }

    for (const c of chaosCards(state, lastKillAt)) {
      const view = cards.get(c.id)!;
      view.button.dataset.status = c.status;
      view.button.setAttribute('aria-disabled', String(c.status !== 'ready'));
      view.state.textContent = STATUS_TEXT[c.status];
      view.bar.style.transform = `scaleX(${c.remaining.toFixed(3)})`;
    }
    speedButtons.forEach(({ s, b }) => b.setAttribute('aria-pressed', String(sim.speed === s)));

    const budget = budgetRing(state.slo.budgetRemaining);
    const lit = dialTicks(budget.fraction, DIAL_TICKS);
    if (lit !== litTicks) {
      const change = dialChange(litTicks, lit);
      const changed = change.indices.map((i) => ticks[i]!);
      changed.forEach((t) => (t.dataset.lit = String(change.lit)));
      litTicks = lit;
      // The new state is already drawn; the blip just shows where it changed, from the boundary out.
      const motionApi = getMotion();
      if (changed.length > 0 && changed.length < DIAL_TICKS) {
        motionApi?.animate(changed, { opacity: [0.15, 1], duration: DURATION.enter, ease: EASE.enter, delay: motionApi.stagger(STAGGER.tick) });
      }
    }
    ring.dataset.tone = budget.tone;
    ring.dataset.exhausted = String(lit === 0);
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
      // Rows are keyed by seq: only entries newer than the last drawn one are added (and animated);
      // a reset (seq going backwards) redraws from scratch.
      const fresh = newest < lastSeq ? timelineRows(state.timeline, ROWS) : timelineRows(state.timeline.filter((e) => e.seq > lastSeq), ROWS);
      if (newest < lastSeq) timeline.replaceChildren();
      const added = fresh.map(row);
      timeline.prepend(...added);
      while (timeline.childElementCount > ROWS) timeline.lastElementChild?.remove();
      const motionApi = getMotion();
      if (lastSeq >= 0 && newest > lastSeq && added.length <= 8) {
        // New rows slide in under a brief accent wash; text stays at full contrast throughout.
        motionApi?.animate(added, {
          translateX: [-8, 0],
          backgroundColor: ['rgba(76, 201, 240, 0.16)', 'rgba(76, 201, 240, 0)'],
          duration: DURATION.state,
          ease: EASE.enter,
          delay: motionApi.stagger(STAGGER.row),
          onComplete: () => clearInline(added, ['transform', 'background-color']),
        });
      }
      lastSeq = newest;
    }
  });

  return () => {
    off();
    offPause();
    unsubscribe.forEach((u) => u());
    live.remove();
  };
}
