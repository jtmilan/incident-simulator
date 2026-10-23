// Every animation the motion engine starts goes through here, so the page has one place that
// answers "Pause motion" (WCAG 2.2.2) and "prefers-reduced-motion". No animation library is
// imported: handles are anything that can pause, resume and jump to its end.

export interface MotionHandle {
  pause(): unknown;
  complete(): unknown;
  readonly completed?: boolean;
  /** Animations are never paused one by one here (the clock is), so a paused handle is one the
   * engine cancelled, e.g. replaced by a newer animation of the same property. */
  readonly paused?: boolean;
}

/** The clock that advances every animation; pausing it freezes them all in place. */
export interface MotionClock {
  pause(): void;
  resume(): void;
}

export interface MotionRegistry {
  readonly reduced: boolean;
  /** Follows a reduced-motion preference changed mid-visit: running animations jump to their end. */
  setReduced(reduced: boolean): void;
  readonly paused: boolean;
  /** Handles still running (not completed). */
  readonly active: number;
  /** Registers an animation. Under reduced motion, or while motion is paused, it jumps straight to its end state. */
  run<H extends MotionHandle>(handle: H): H;
  setPaused(paused: boolean): void;
}

export function createRegistry({ reduced, clock }: { reduced: boolean; clock: MotionClock }): MotionRegistry {
  const handles = new Set<MotionHandle>();
  let paused = false;
  let isReduced = reduced;

  const prune = () => {
    for (const h of handles) if (h.completed || h.paused) handles.delete(h);
  };

  return {
    get reduced() {
      return isReduced;
    },
    setReduced(next) {
      isReduced = next;
      if (!next) return;
      for (const h of handles) h.complete();
      handles.clear();
    },
    get paused() {
      return paused;
    },
    get active() {
      prune();
      return handles.size;
    },
    run(handle) {
      // Paused or reduced: show where it would end up rather than freezing on its first frame.
      if (isReduced || paused) {
        handle.complete();
        return handle;
      }
      prune();
      handles.add(handle);
      return handle;
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      if (paused) clock.pause();
      else clock.resume();
    },
  };
}
