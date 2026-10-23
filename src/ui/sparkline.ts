import { sparkPoints } from './view-models.ts';

/** A tiny canvas line chart, sized for the device pixel ratio. Redrawn only when asked. */
export function createSparkline(label: string) {
  const canvas = document.createElement('canvas');
  canvas.className = 'spark';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${label}, last 2 minutes`);
  const width = 256;
  const height = 30;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');

  return {
    canvas,
    draw(values: readonly number[], colour: string) {
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const points = sparkPoints(values, width, height, 2);
      if (points.length < 2) return;
      ctx.beginPath();
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      const last = points.at(-1)!;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}
