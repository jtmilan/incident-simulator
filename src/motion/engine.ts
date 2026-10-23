import { animate, createSpring, createTimeline, engine, onScroll, stagger, utils } from 'animejs';
import type { AnimationParams, JSAnimation, ScrollObserver, ScrollObserverParams, StaggerFunction, StaggerParams, TargetsParam, Timeline, TimelineParams } from 'animejs';
import type { Loop } from '../app/loop.ts';
import { motion } from '../app/motion.ts';
import { PRESS_SPRING } from './presets.ts';
import { createRegistry, type MotionRegistry } from './registry.ts';

// anime.js 4.5.0 (MIT), loaded in its own chunk after first paint. It runs on the page's shared
// clock instead of its own requestAnimationFrame loop, so the simulator, the 3D scene and every UI
// animation advance on one frame, stop together when the tab is hidden, and freeze together on
// "Pause motion".

export interface MotionApi {
  readonly registry: MotionRegistry;
  animate(targets: TargetsParam, params: AnimationParams): JSAnimation;
  timeline(params?: TimelineParams): Timeline;
  /** Registers a timeline built with `timeline()` once its segments are added. */
  play(timeline: Timeline): Timeline;
  stagger(value: number | [number, number], params?: StaggerParams): StaggerFunction<number>;
  /** Spring ease for presses. */
  press: ReturnType<typeof createSpring>;
  /** Sets properties immediately, with no animation. */
  set(targets: TargetsParam, props: AnimationParams): void;
  /** A scroll observer; pass it as a timeline's `autoplay` to drive the timeline from scroll. */
  scroll(params: ScrollObserverParams): ScrollObserver;
}

export function startMotion({ loop, reducedMotion }: { loop: Loop; reducedMotion: boolean }): MotionApi {
  engine.useDefaultMainLoop = false;
  engine.pauseOnDocumentHidden = false; // the shared loop already stops while the tab is hidden

  const registry = createRegistry({
    reduced: reducedMotion,
    clock: {
      pause: () => {
        engine.paused = true;
      },
      // resume() re-bases every running animation on the current time, so each continues from
      // where it froze instead of jumping ahead by the paused duration.
      resume: () => void engine.resume(),
    },
  });
  registry.setPaused(motion.paused);
  motion.subscribe((paused) => registry.setPaused(paused));
  loop.add(() => {
    if (!registry.paused) engine.update();
  });

  return {
    registry,
    animate: (targets, params) => registry.run(animate(targets, params)),
    timeline: (params) => createTimeline({ autoplay: true, ...params }),
    play: (timeline) => registry.run(timeline),
    // Narrowed per overload: anime.js types a single value and a [from, to] range separately.
    stagger: (value, params) => (typeof value === 'number' ? stagger(value, params) : stagger(value, params)),
    press: createSpring(PRESS_SPRING),
    set: (targets, props) => void utils.set(targets, props),
    scroll: (params) => onScroll(params),
  };
}
