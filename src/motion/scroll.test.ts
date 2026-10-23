import { describe, expect, it } from 'vitest';
import { STORY_SEGMENTS, ringPose, segmentDurations } from './scroll.ts';

describe('ringPose', () => {
  it('starts at rest and ends turned 60° and receded to 88%', () => {
    expect(ringPose(0)).toEqual({ rotateDeg: 0, scale: 1 });
    expect(ringPose(1).rotateDeg).toBe(60);
    expect(ringPose(1).scale).toBeCloseTo(0.88, 9);
    expect(ringPose(0.5).rotateDeg).toBe(30);
  });

  it('clamps outside the story', () => {
    expect(ringPose(-1)).toEqual(ringPose(0));
    expect(ringPose(3)).toEqual(ringPose(1));
  });
});

describe('segmentDurations', () => {
  it('sizes each labelled segment by the scroll it covers', () => {
    expect(STORY_SEGMENTS).toEqual(['HERO', 'INFRA', 'FOOTER']);
    // Hero until 600 px, infra until 1800 px, footer until the end at 2400 px.
    expect(segmentDurations([0, 600, 1800], 2_400)).toEqual([750, 1_500, 750]);
  });

  it('clamps starts to the page and never returns a zero or negative duration', () => {
    const d = segmentDurations([0, 3_000, 2_000], 2_400);
    expect(d.every((x) => x >= 1)).toBe(true);
    expect(segmentDurations([0, 0, 0], 0)).toEqual([1, 1, 3_000]);
  });
});
