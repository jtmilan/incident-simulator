import type { Loop } from '../app/loop.ts';
import { motion } from '../app/motion.ts';
import type { Simulation } from '../sim/simulation.ts';
import type { SimEvent } from '../sim/types.ts';
import { DURATION, EASE } from '../motion/presets.ts';
import { getMotion } from '../motion/ready.ts';
import { clearInline, el } from './dom.ts';
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
  // Content sits in an inner wrapper so its entrance can move it while the card itself is positioned.
  const inner = el('div', 'tour-inner');
  inner.append(count, track, title, body, status, nav);
  card.append(inner);

  let running = false;
  let index = 0;
  let opener: HTMLElement | null = null;
  let progress: StepProgress[] = [];
  let ran = new Set<number>();
  let box: Box | null = null;
  /** While the engine eases the spotlight to a new target: where it came from and how far along (0→1). */
  let blend: { from: Box; v: number } | null = null;
  /** The element the spotlight frames and the card's size: looked up when the step or its state changes, not per frame. */
  let target: HTMLElement | null = null;
  let cardSize = { width: 0, height: 0 };
  /** Resets the tour dispatched itself (step 1), which must not count as the visitor resetting mid-step. */
  let ownResets = 0;
  let lastStatus = '';
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let offLoop: (() => void) | null = null;
  let offBus: (() => void) | null = null;

  const step = () => steps[index]!;
  const targetId = () => {
    const s = step();
    return progress[index]?.met && s.doneTarget ? s.doneTarget : s.target;
  };

  /** Finds the current target and brings it on screen (selecting its tab on phones). */
  const retarget = () => {
    // Ease from the current frame to the new target with inOut(3); the frame loop keeps following
    // the target if it moves meanwhile. Without the engine, the damping below does the move.
    const motionApi = getMotion();
    // While motion is paused the engine doesn't advance, so the frame loop's damping does the move.
    if (motionApi && box && !reducedMotion && !motion.paused) {
      const b = { from: { ...box }, v: 0 };
      blend = b;
      motionApi.animate(b, {
        v: 1,
        duration: DURATION.state,
        ease: EASE.state,
        onComplete: () => {
          if (blend === b) blend = null;
        },
      });
    }
    target = document.querySelector<HTMLElement>(`[data-tour="${targetId()}"]`);
    if (!target) return;
    reveal?.(target);
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const measureCard = () => {
    cardSize = { width: card.offsetWidth, height: card.offsetHeight };
  };

  const setStatus = () => {
    const text = statusLine(step(), progress[index]!, sim.state.t, motion.paused);
    if (text === lastStatus) return;
    lastStatus = text;
    status.textContent = text;
    status.dataset.met = String(progress[index]!.met);
    measureCard(); // the status line can change the card's height
  };

  const show = (i: number, { focus }: { focus: boolean }) => {
    if (advanceTimer !== null) clearTimeout(advanceTimer);
    advanceTimer = null;
    index = i;
    const s = step();
    if (!ran.has(i)) {
      ran.add(i);
      progress[i] = { met: false, startedAt: sim.state.t };
      s.actions?.forEach((command) => {
        if (command.type === 'reset') ownResets++;
        sim.dispatch(command);
      });
    }
    count.textContent = `Guided tour · ${i + 1} / ${steps.length}`;
    bar.style.transform = `scaleX(${((i + 1) / steps.length).toFixed(3)})`;
    title.textContent = s.title;
    body.textContent = s.body;
    lastStatus = '\u0000';
    setStatus();
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    measureCard();
    retarget();
    // Text moves in rather than fading from invisible, so it is readable (and at full contrast) throughout.
    getMotion()?.animate(inner, { translateY: [8, 0], duration: DURATION.enter, ease: EASE.enter, onComplete: () => clearInline([inner], ['transform']) });
    if (focus) title.focus({ preventScroll: true });
  };

  const go = (i: number) => {
    if (i >= steps.length) return end();
    show(Math.max(i, 0), { focus: true });
  };

  const onEvent = (event: SimEvent) => {
    const s = step();
    if (event.type === 'reset' && ownResets > 0) {
      ownResets--;
      return;
    }
    const p = progress[index];
    if (!p || p.met) return;
    // The visitor pressed Reset mid-step: the experiment this step started is gone, so say so
    // rather than wait for an event that can't come.
    if (event.type === 'reset') {
      progress[index] = { met: false, startedAt: 0, interrupted: s.waitFor !== undefined };
      setStatus();
      return;
    }
    if (!s.waitFor?.(event, sim.state)) return;
    progress[index] = { met: true, text: s.done?.(event, sim.state) ?? '' };
    setStatus();
    if (s.doneTarget) retarget();
    if (s.autoAdvance) {
      const from = index;
      advanceTimer = setTimeout(() => {
        if (!running || index !== from) return;
        // Keep focus with the card only if the visitor was in it; never pull it from elsewhere.
        show(from + 1, { focus: card.contains(document.activeElement) });
      }, AUTO_ADVANCE_MS);
    }
  };

  // One layout read per frame (the target's rect), then writes only.
  const frame = (dtMs: number) => {
    setStatus();
    if (target && !target.isConnected) target = null;
    const rect = target?.getBoundingClientRect();
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    if (!rect || rect.width === 0 || rect.height === 0) {
      spot.hidden = true;
      box = null;
    } else {
      const want: Box = { left: rect.left - SPOT_PAD, top: rect.top - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 };
      if (box === null || reducedMotion) box = want;
      else if (blend) {
        const { from, v } = blend;
        box = {
          left: from.left + (want.left - from.left) * v,
          top: from.top + (want.top - from.top) * v,
          width: from.width + (want.width - from.width) * v,
          height: from.height + (want.height - from.height) * v,
        };
      } else {
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
    const pos = placeCard(box, cardSize, view);
    card.style.transform = `translate(${pos.left.toFixed(0)}px, ${pos.top.toFixed(0)}px)`;
  };

  const onKey = (event: KeyboardEvent) => {
    // Esc inside the "real config" dialog closes that dialog, not the tour.
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    end();
  };

  const onResize = () => measureCard();

  next.addEventListener('click', () => go(index + 1));
  back.addEventListener('click', () => go(index - 1));
  skip.addEventListener('click', () => end());

  /** Takes the tour off the page. */
  const teardown = () => {
    running = false;
    if (advanceTimer !== null) clearTimeout(advanceTimer);
    advanceTimer = null;
    offBus?.();
    offLoop?.();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    spot.remove();
    card.remove();
    delete document.body.dataset.tour;
  };

  function start(from: HTMLElement | null) {
    // A restart replaces the running tour in place: no focus hand-back, no onEnd (the URL stays #tour).
    if (running) teardown();
    running = true;
    opener = from;
    progress = [];
    ran = new Set();
    ownResets = 0;
    box = null;
    blend = null;
    target = null;
    document.body.append(spot, card);
    document.body.dataset.tour = 'on';
    offBus = sim.bus.onAny(onEvent);
    offLoop = loop.add((dt) => frame(dt));
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    show(0, { focus: true });
    frame(0);
  }

  function end(restoreFocus = true) {
    if (!running) return;
    teardown();
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
