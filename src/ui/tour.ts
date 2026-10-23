import type { Loop } from '../app/loop.ts';
import type { Simulation } from '../sim/simulation.ts';
import type { SimEvent } from '../sim/types.ts';
import { el } from './dom.ts';
import { placeCard, statusLine, TOUR_STEPS, type Box, type StepProgress, type TourStep } from './tour-script.ts';

// The guided tour on screen: a spotlight that follows the step's target and a step card beside it.
// Non-modal, so the console stays usable underneath. Esc, Skip or Finish ends it and hands focus back.

export interface TourOptions {
  sim: Simulation;
  loop: Loop;
  reducedMotion: boolean;
  /** Puts a target on screen first (on phones, selects the tab it lives in). */
  reveal?: (target: HTMLElement) => void;
  /** Where focus goes at the end when the element that started the tour can't take it. */
  fallbackFocus: () => HTMLElement | null;
  onEnd?: () => void;
  steps?: readonly TourStep[];
}

export interface Tour {
  readonly running: boolean;
  /** Starts (or restarts) from step 1. */
  start(opener: HTMLElement | null): void;
  end(restoreFocus?: boolean): void;
}

/** Real time a met auto-step stays on screen before moving on, so its result can be read. */
const AUTO_ADVANCE_MS = 1_800;
const SPOT_PAD = 6;
/** Spotlight damping rate (1/s): glides between targets in roughly a quarter second. */
const SPOT_LAMBDA = 14;

const focusable = (node: HTMLElement | null): node is HTMLElement =>
  node !== null && node.isConnected && node.closest('[inert]') === null && node.getClientRects().length > 0;

function button(className: string, text: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

export function createTour({ sim, loop, reducedMotion, reveal, fallbackFocus, onEnd, steps = TOUR_STEPS }: TourOptions): Tour {
  const spot = el('div', 'tour-spot');
  spot.setAttribute('aria-hidden', 'true');
  spot.hidden = true;

  const card = el('section', 'tour-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.setAttribute('aria-describedby', 'tour-body');
  const count = el('p', 'tour-count');
  const bar = el('span', 'tour-progress-bar');
  const track = el('span', 'tour-progress');
  track.setAttribute('aria-hidden', 'true');
  track.append(bar);
  const title = el('h2', 'tour-title');
  title.id = 'tour-title';
  title.tabIndex = -1;
  const body = el('p', 'tour-body');
  body.id = 'tour-body';
  const status = el('p', 'tour-status');
  status.setAttribute('role', 'status');
  const skip = button('btn-ghost tour-skip', 'Skip tour');
  const back = button('btn-ghost', 'Back');
  const next = button('tour-next', 'Next');
  const nav = el('div', 'tour-nav');
  nav.append(skip, back, next);
  card.append(count, track, title, body, status, nav);

  let running = false;
  let index = 0;
  let opener: HTMLElement | null = null;
  let progress: StepProgress[] = [];
  let ran = new Set<number>();
  let box: Box | null = null;
  let lastStatus = '';
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let offLoop: (() => void) | null = null;
  let offBus: (() => void) | null = null;

  const step = () => steps[index]!;
  const targetId = () => {
    const s = step();
    return progress[index]?.met && s.doneTarget ? s.doneTarget : s.target;
  };
  const targetEl = () => document.querySelector<HTMLElement>(`[data-tour="${targetId()}"]`);

  const bringIntoView = () => {
    const target = targetEl();
    if (!target) return;
    reveal?.(target);
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const setStatus = () => {
    const text = statusLine(step(), progress[index]!, sim.state.t);
    if (text === lastStatus) return;
    lastStatus = text;
    status.textContent = text;
    status.dataset.met = String(progress[index]!.met);
  };

  const show = (i: number, { focus }: { focus: boolean }) => {
    if (advanceTimer !== null) clearTimeout(advanceTimer);
    advanceTimer = null;
    index = i;
    const s = step();
    if (!ran.has(i)) {
      ran.add(i);
      progress[i] = { met: false, startedAt: sim.state.t };
      s.actions?.forEach((command) => sim.dispatch(command));
    }
    count.textContent = `Guided tour · ${i + 1} / ${steps.length}`;
    bar.style.transform = `scaleX(${((i + 1) / steps.length).toFixed(3)})`;
    title.textContent = s.title;
    body.textContent = s.body;
    lastStatus = '\u0000';
    setStatus();
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    bringIntoView();
    if (!reducedMotion) card.animate?.([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    if (focus) title.focus({ preventScroll: true });
  };

  const go = (i: number) => {
    if (i >= steps.length) return end();
    show(Math.max(i, 0), { focus: true });
  };

  const onEvent = (event: SimEvent) => {
    const s = step();
    const p = progress[index];
    if (!p || p.met) return;
    // A Reset from the console restarts sim time; restart this step's timeout with it.
    if (event.type === 'reset') progress[index] = { met: false, startedAt: 0 };
    if (!s.waitFor?.(event, sim.state)) return;
    progress[index] = { met: true, text: s.done?.(event, sim.state) ?? '' };
    setStatus();
    if (s.doneTarget) bringIntoView();
    if (s.autoAdvance) {
      const from = index;
      advanceTimer = setTimeout(() => {
        if (!running || index !== from) return;
        // Keep focus with the card only if the visitor was in it; never pull it from elsewhere.
        show(from + 1, { focus: card.contains(document.activeElement) });
      }, AUTO_ADVANCE_MS);
    }
  };

  const frame = (dtMs: number) => {
    setStatus();
    const target = targetEl();
    const rect = target?.getBoundingClientRect();
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    if (!rect || rect.width === 0 || rect.height === 0) {
      spot.hidden = true;
      box = null;
    } else {
      const want: Box = { left: rect.left - SPOT_PAD, top: rect.top - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 };
      if (box === null || reducedMotion) box = want;
      else {
        const k = 1 - Math.exp(-SPOT_LAMBDA * Math.min(dtMs, 100) / 1_000);
        box = {
          left: box.left + (want.left - box.left) * k,
          top: box.top + (want.top - box.top) * k,
          width: box.width + (want.width - box.width) * k,
          height: box.height + (want.height - box.height) * k,
        };
      }
      spot.hidden = false;
      spot.style.transform = `translate(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px)`;
      spot.style.width = `${box.width.toFixed(1)}px`;
      spot.style.height = `${box.height.toFixed(1)}px`;
    }
    const pos = placeCard(box, { width: card.offsetWidth, height: card.offsetHeight }, view);
    card.style.transform = `translate(${pos.left.toFixed(0)}px, ${pos.top.toFixed(0)}px)`;
  };

  const onKey = (event: KeyboardEvent) => {
    // Esc inside the "real config" dialog closes that dialog, not the tour.
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    end();
  };

  next.addEventListener('click', () => go(index + 1));
  back.addEventListener('click', () => go(index - 1));
  skip.addEventListener('click', () => end());

  function start(from: HTMLElement | null) {
    if (running) end(false);
    running = true;
    opener = from;
    progress = [];
    ran = new Set();
    box = null;
    document.body.append(spot, card);
    document.body.dataset.tour = 'on';
    offBus = sim.bus.onAny(onEvent);
    offLoop = loop.add((dt) => frame(dt));
    document.addEventListener('keydown', onKey);
    show(0, { focus: true });
    frame(0);
  }

  function end(restoreFocus = true) {
    if (!running) return;
    running = false;
    if (advanceTimer !== null) clearTimeout(advanceTimer);
    advanceTimer = null;
    offBus?.();
    offLoop?.();
    document.removeEventListener('keydown', onKey);
    spot.remove();
    card.remove();
    delete document.body.dataset.tour;
    if (restoreFocus) {
      const to = focusable(opener) ? opener : fallbackFocus();
      to?.focus({ preventScroll: true });
    }
    opener = null;
    onEnd?.();
  }

  return {
    get running() {
      return running;
    },
    start,
    end,
  };
}
