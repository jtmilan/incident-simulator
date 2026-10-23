/** Drops inline styles an animation left behind, so stylesheet rules (hover, severity) apply again. */
export function clearInline(nodes: Iterable<HTMLElement>, props: readonly string[]): void {
  for (const node of nodes) props.forEach((p) => node.style.removeProperty(p));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
