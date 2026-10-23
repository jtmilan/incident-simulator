/**
 * Splits the hero headline into letters that rise into place (CSS animation, 50 ms stagger).
 * Screen readers get the heading once via aria-label; the letters themselves are aria-hidden.
 * Letters start blurred and offset rather than invisible, so the headline still paints at once.
 */
export function mountHeadline(heading: HTMLElement): void {
  const text = heading.textContent?.trim() ?? '';
  if (!text) return;
  heading.setAttribute('aria-label', text);

  const letters = document.createElement('span');
  letters.setAttribute('aria-hidden', 'true');
  let index = 0;
  text.split(/\s+/).forEach((word, w) => {
    if (w > 0) letters.append(' ');
    const wordEl = document.createElement('span');
    wordEl.className = 'word';
    for (const char of word) {
      const letter = document.createElement('span');
      letter.className = 'ch';
      letter.textContent = char;
      letter.style.setProperty('--i', String(index++));
      wordEl.append(letter);
    }
    letters.append(wordEl);
  });
  heading.replaceChildren(letters);
}
