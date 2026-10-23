// On narrow screens the console shows one panel at a time under the 3D view (Chaos · Health ·
// Timeline): a standard ARIA tablist with roving tabindex, arrow keys and Home/End. Tab semantics
// exist only while that layout is on screen; on wide screens the panels keep their own landmarks.

const NARROW = '(max-width: 64rem)';

export interface MobileTabs {
  /** On the tab layout, selects the tab whose panel holds `node` (used by the guided tour). */
  reveal(node: Element): void;
}

export function mountMobileTabs(grid: HTMLElement, panels: { id: string; label: string; panel: HTMLElement }[]): MobileTabs {
  const list = document.createElement('div');
  list.className = 'mobile-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Console panels');
  let selected = 0;

  const tabs = panels.map(({ id, label, panel }, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `tab-${id}`;
    tab.className = 'mobile-tab';
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    panel.id ||= `panel-${id}`;
    tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => select(index));
    list.append(tab);
    return tab;
  });

  const narrow = window.matchMedia(NARROW);

  const select = (index: number, focus = false) => {
    selected = index;
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (narrow.matches) panels[i]!.panel.dataset.active = String(active);
    });
    if (focus) tabs[index]!.focus();
  };

  const applyLayout = () => {
    for (const [i, { panel }] of panels.entries()) {
      if (narrow.matches) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabs[i]!.id);
      } else {
        // Back to the panel's own landmark role and aria-label.
        panel.removeAttribute('role');
        panel.removeAttribute('aria-labelledby');
        delete panel.dataset.active;
      }
    }
    select(selected);
  };

  list.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next =
      event.key === 'ArrowRight' ? (current + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    select(next, true);
  });

  grid.prepend(list);
  narrow.addEventListener('change', applyLayout);
  applyLayout();

  return {
    reveal(node) {
      if (!narrow.matches) return;
      const index = panels.findIndex(({ panel }) => panel.contains(node));
      if (index >= 0 && index !== selected) select(index);
    },
  };
}
