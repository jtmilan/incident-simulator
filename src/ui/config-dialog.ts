import { highlightLine, REAL_CONFIG } from './real-config.ts';
import { el } from './dom.ts';

export type ConfigKey = keyof typeof REAL_CONFIG;


/**
 * One native <dialog> for every "real config" panel: showModal() gives focus containment, Esc to
 * close and an inert page behind it. Content is static text, rendered with textContent.
 */
export function createConfigDialog(): (key: ConfigKey, opener: HTMLElement) => void {
  const dialog = el('dialog', 'config-dialog');
  dialog.setAttribute('aria-labelledby', 'config-title');
  const header = el('header', 'config-header');
  const title = el('h2', undefined);
  title.id = 'config-title';
  const close = el('button', 'btn-ghost', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);
  const intro = el('p', 'config-intro');
  const files = el('div', 'config-files');
  dialog.append(header, intro, files);
  document.body.append(dialog);

  let opener: HTMLElement | null = null;
  dialog.addEventListener('close', () => opener?.focus());

  return (key, from) => {
    const section = REAL_CONFIG[key];
    opener = from;
    title.textContent = section.title;
    intro.textContent = section.intro;
    files.replaceChildren(
      ...section.files.map((file) => {
        const figure = el('figure', 'config-file');
        const caption = el('figcaption');
        const copy = el('button', 'btn-ghost copy', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(file.body).then(
            () => (copy.textContent = 'Copied'),
            () => (copy.textContent = 'Copy failed'),
          );
        });
        caption.append(el('span', 'config-filename', file.file), copy);
        figure.append(caption);
        if (file.note) figure.append(el('p', 'config-note', file.note));
        const code = el('code');
        for (const line of file.body.split('\n')) {
          for (const segment of highlightLine(line)) code.append(segment.kind === 'plain' ? document.createTextNode(segment.text) : el('span', `tok-${segment.kind}`, segment.text));
          code.append('\n');
        }
        const pre = el('pre');
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', file.file);
        pre.append(code);
        figure.append(pre);
        return figure;
      }),
    );
    dialog.showModal();
  };
}

export function configButton(label = '</> real config'): HTMLButtonElement {
  const button = el('button', 'config-link', label);
  button.type = 'button';
  return button;
}
