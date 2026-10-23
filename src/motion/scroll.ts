// Pure pieces of the scroll story: where the half-dial sits for a given story position, and how the
// page's scroll range splits into the story's labelled segments.

export const STORY_SEGMENTS = ['HERO', 'INFRA', 'FOOTER'] as const;
export type StorySegment = (typeof STORY_SEGMENTS)[number];

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** The half-dial turns up to 60° and recedes to 88% as the story moves from the hero to the infra section. */
export function ringPose(t: number): { rotateDeg: number; scale: number } {
  const k = clamp01(t);
  return { rotateDeg: 60 * k, scale: 1 - 0.12 * k };
}

/**
 * Timeline durations for the labelled segments, proportional to the page scroll each one covers.
 * `starts` are the scroll positions where HERO, INFRA and FOOTER begin; the story ends at `maxScroll`.
 */
export function segmentDurations(starts: readonly number[], maxScroll: number, total = 3_000): number[] {
  const end = Math.max(maxScroll, 1);
  const bounded = starts.map((s) => Math.min(Math.max(s, 0), end));
  return bounded.map((start, i) => {
    const next = i + 1 < bounded.length ? Math.max(bounded[i + 1]!, start) : end;
    // Never zero: anime.js needs a positive duration for every segment.
    return Math.max(((next - start) / end) * total, 1);
  });
}
