/**
 * Splits an element's text into letter spans (grouped in non-breaking word spans) so they can move
 * one by one. Screen readers get the text once through aria-label; the letters are aria-hidden.
 * Built with textContent only, never innerHTML.
 */
export function splitLetters(el: HTMLElement, { label = true }: { label?: boolean } = {}): HTMLElement[] {
  const text = el.textContent?.trim() ?? '';
  if (!text) return [];
  // Decorative text that is already aria-hidden needs no label (and a <p> may not carry one).
  if (label) el.setAttribute('aria-label', text);
  el.classList.add('split');

  const wrapper = document.createElement('span');
  wrapper.setAttribute('aria-hidden', 'true');
  const letters: HTMLElement[] = [];
  text.split(/\s+/).forEach((word, w) => {
    if (w > 0) wrapper.append(' ');
    const wordEl = document.createElement('span');
    wordEl.className = 'word';
    for (const char of word) {
      const letter = document.createElement('span');
      letter.className = 'ch';
      letter.textContent = char;
      letter.style.setProperty('--i', String(letters.length));
      wordEl.append(letter);
      letters.push(letter);
    }
    wrapper.append(wordEl);
  });
  el.replaceChildren(wrapper);
  return letters;
}
