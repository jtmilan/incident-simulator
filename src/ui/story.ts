import type { ScrollObserver, Timeline } from 'animejs';
import type { MotionApi } from '../motion/engine.ts';
import { DURATION, EASE } from '../motion/presets.ts';
import { STORY_SEGMENTS, ringPose, segmentDurations } from '../motion/scroll.ts';
import { clearInline } from './dom.ts';
import { splitLetters } from './split.ts';

// The hero's scroll story (loaded with the motion engine, after first paint). One timeline with
// labelled segments follows the page scroll, smoothed: the camera orbits the cluster and the
// half-dial turns as the visitor moves from the hero into "How this maps to real infrastructure".
// Sections then reveal once as they come into view. Everything here is decoration on top of a
// page that is already complete: without it, every element sits in its final place.

const FIELD_COLS = 14;
const FIELD_ROWS = 6;
/** Room left for the status strip when the infra section reaches the top. */
const STRIP_OFFSET = 80;

type SceneLike = { setScroll(progress: number): void };

export interface StoryHooks {
  /** Calls back with the 3D scene now, or once it has loaded. */
  onScene: (fn: (scene: SceneLike) => void) => void;
}

const inView = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
};

/** Calls `play` the first time `el` comes into view (a little above the bottom edge). */
function onFirstView(el: Element, play: () => void): void {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      play();
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  io.observe(el);
}

export function startStory(motion: MotionApi, { onScene }: StoryHooks): void {
  if (motion.registry.reduced) return;

  // ---- Scroll-synced storyline ----
  // Not registered with the one-shot registry: a scrubbed timeline never "completes", and jumping
  // it to its end would orbit the camera while the visitor is still at the top. Pause motion still
  // freezes it (the engine clock stops); reduced motion turned on mid-visit puts everything at rest.
  const ring = document.querySelector<SVGSVGElement>('.boot-ring svg');
  const infra = document.querySelector<HTMLElement>('.infra');
  const footer = document.querySelector<HTMLElement>('.site-footer');
  const narrow = window.matchMedia('(max-width: 40rem)'); // the ring is hidden on phones
  const state = { orbit: 0, ring: 0 };
  let scene: SceneLike | null = null;
  let story: Timeline | null = null;
  let observer: ScrollObserver | null = null;

  const apply = () => {
    if (document.body.dataset.mode !== 'hero') return;
    scene?.setScroll(state.orbit);
    if (ring && !narrow.matches) {
      const pose = ringPose(state.ring);
      ring.style.transform = `rotate(${pose.rotateDeg.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;
    }
  };
  onScene((s) => {
    scene = s;
    s.setScroll(state.orbit); // a scene that loads mid-scroll starts where the story is
  });

  const stop = () => {
    observer?.revert();
    story?.revert();
    observer = null;
    story = null;
  };

  // Segment lengths follow the page: the orbit completes as the infra section reaches the top.
  const build = () => {
    stop();
    const top = (el: HTMLElement | null) => (el ? el.getBoundingClientRect().top + window.scrollY : 0);
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const starts = [0, top(infra) - STRIP_OFFSET, footer ? top(footer) - window.innerHeight : maxScroll];
    const [hero = 1, mid = 1, end = 1] = segmentDurations(starts, maxScroll);
    observer = motion.scroll({ target: document.body, enter: 'top top', leave: 'bottom bottom', sync: 0.9 });
    story = motion.timeline({ autoplay: observer, defaults: { ease: EASE.loop }, onUpdate: apply });
    story
      .label(STORY_SEGMENTS[0])
      .add(state, { orbit: [0, 1], ring: [0, 1], duration: hero })
      .label(STORY_SEGMENTS[1])
      .add(state, { orbit: 1, ring: 1, duration: mid })
      .label(STORY_SEGMENTS[2])
      .add(state, { orbit: 1, ring: 1, duration: end });
  };

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 300);
  };
  window.addEventListener('resize', onResize);

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    if (!e.matches) return;
    window.removeEventListener('resize', onResize);
    stop();
    state.orbit = 0;
    state.ring = 0;
    scene?.setScroll(0);
    ring?.style.removeProperty('transform');
  });

  // ---- Infra section: heading letters, map rows, a field of replicas ----
  // Text already on screen when this loads stays put: only content still to come moves in.
  if (infra) {
    const heading = infra.querySelector<HTMLElement>('h2');
    if (heading && !inView(heading)) {
      const letters = splitLetters(heading);
      onFirstView(heading, () => {
        motion.animate(letters, {
          translateY: ['0.6em', '0em'],
          duration: DURATION.state,
          ease: EASE.enter,
          delay: motion.stagger(12),
          onComplete: () => clearInline(letters, ['transform']),
        });
      });
    }

    const rows = [...infra.querySelectorAll<HTMLElement>('.infra-row')].filter((row) => !inView(row));
    if (rows[0]) {
      onFirstView(rows[0], () => {
        motion.animate(rows, {
          translateY: [16, 0],
          duration: DURATION.state,
          ease: EASE.enter,
          delay: motion.stagger(40),
          onComplete: () => clearInline(rows, ['transform']),
        });
      });
    }

    // The field is new, so it can ripple in even if its spot is already on screen.
    const field = document.createElement('div');
    field.className = 'infra-field';
    field.setAttribute('aria-hidden', 'true');
    const dots = Array.from({ length: FIELD_COLS * FIELD_ROWS }, () => {
      const dot = document.createElement('span');
      field.append(dot);
      return dot;
    });
    infra.append(field);
    onFirstView(field, () => {
      motion.animate(dots, {
        scale: [0.3, 1.6, 1],
        duration: 900,
        ease: EASE.state,
        delay: motion.stagger(26, { grid: [FIELD_COLS, FIELD_ROWS], from: 'center' }),
        onComplete: () => clearInline(dots, ['transform']),
      });
    });
  }

  // ---- Footer wordmark rises from the centre ----
  const wordmark = document.querySelector<HTMLElement>('.wordmark');
  if (wordmark && !inView(wordmark)) {
    const letters = splitLetters(wordmark, { label: false });
    onFirstView(wordmark, () => {
      motion.animate(letters, {
        translateY: ['45%', '0%'],
        duration: 700,
        ease: EASE.enter,
        delay: motion.stagger(22, { from: 'center' }),
        onComplete: () => clearInline(letters, ['transform']),
      });
    });
  }

  build();
}
