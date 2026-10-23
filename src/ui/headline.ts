import { splitLetters } from './split.ts';

/**
 * Splits the hero headline into letters that rise into place (CSS animation, 50 ms stagger).
 * Screen readers get the heading once via aria-label; the letters themselves are aria-hidden.
 * Letters start blurred and offset rather than invisible, so the headline still paints at once.
 */
export function mountHeadline(heading: HTMLElement): void {
  splitLetters(heading);
}
