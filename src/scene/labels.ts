import { Vector3, type Camera } from 'three';

export interface LabelSpec {
  key: string;
  x: number;
  y: number;
  z: number;
  text: string;
  tone: 'muted' | 'primary' | 'down';
}

/**
 * DOM labels pinned to points in the 3D scene (nodes, database roles, ingress). Repositioned each
 * frame from the camera projection; text is written only when it changes, always via textContent.
 */
export function createSceneLabels(host: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'scene-labels';
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;
  host.append(root);
  const elements = new Map<string, HTMLSpanElement>();
  const point = new Vector3();

  return {
    update(camera: Camera, width: number, height: number, specs: readonly LabelSpec[]) {
      if (root.hidden) return;
      for (const spec of specs) {
        let el = elements.get(spec.key);
        if (!el) {
          el = document.createElement('span');
          el.className = 'scene-label';
          root.append(el);
          elements.set(spec.key, el);
        }
        if (el.textContent !== spec.text) el.textContent = spec.text;
        if (el.dataset.tone !== spec.tone) el.dataset.tone = spec.tone;
        point.set(spec.x, spec.y, spec.z).project(camera);
        const visible = point.z < 1 && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1;
        el.style.visibility = visible ? 'visible' : 'hidden';
        const sx = ((point.x + 1) / 2) * width;
        const sy = ((1 - point.y) / 2) * height;
        el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, 0)`;
      }
    },
    setVisible(visible: boolean) {
      root.hidden = !visible;
    },
    dispose() {
      root.remove();
    },
  };
}
