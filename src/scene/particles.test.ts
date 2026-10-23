import { describe, expect, it } from 'vitest';
import type { Vec3 } from './layout.ts';
import { aliveCount, createParticles, destination, particlePosition, stepParticles, travelSeconds, type ParticleEnv } from './particles.ts';

const pods: Vec3[] = [
  { x: -6, y: 1, z: 0 },
  { x: 0, y: 1, z: -1 },
  { x: 6, y: 1, z: 0 },
];
const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({
  rps: 400,
  p99: 140,
  errorRatio: 0.0002,
  writeFailureRatio: 0,
  readyTargets: pods,
  ingress: { x: 0, y: 1, z: 9 },
  primary: { x: -2.4, y: 1, z: -7.5 },
  replica: { x: 2.4, y: 1, z: -7.5 },
  ...over,
});

function run(model: ReturnType<typeof createParticles>, seconds: number, e: ParticleEnv, onStep?: () => void) {
  for (let i = 0; i < seconds / 0.05; i++) {
    stepParticles(model, 0.05, e);
    onStep?.();
  }
}

describe('particle model', () => {
  it('spawns in proportion to rps (100/s at 400 rps)', () => {
    const model = createParticles(2_000);
    run(model, 10, env());
    expect(model.spawned).toBeGreaterThan(950);
    expect(model.spawned).toBeLessThan(1_050);

    const surge = createParticles(5_000);
    run(surge, 10, env({ rps: 1_200 }));
    expect(surge.spawned / model.spawned).toBeCloseTo(3, 0);
  });

  it('never keeps more particles alive than the quality budget', () => {
    const model = createParticles(120);
    let peak = 0;
    run(model, 5, env({ rps: 4_000 }), () => (peak = Math.max(peak, aliveCount(model))));
    expect(peak).toBe(120);
  });

  it('marks about errorRatio of particles as errors and bounces them back to the ingress', () => {
    const model = createParticles(5_000);
    let bounces = 0;
    run(model, 25, env({ errorRatio: 0.2 }), () => (bounces = model.particles.filter((p) => p.alive && p.leg === 'bounce').length || bounces));
    const errored = model.particles.filter((p) => p.error).length;
    const share = errored / model.particles.filter((p) => p.alive || p.error).length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(bounces).toBeGreaterThan(0);
  });

  it('slows travel as tail latency rises (+400 ms is at least 3× slower)', () => {
    expect(travelSeconds(540) / travelSeconds(140)).toBeGreaterThanOrEqual(3);
    expect(travelSeconds(50)).toBe(travelSeconds(140));
  });

  it('sends ~30% of successful requests on to the database', () => {
    const model = createParticles(5_000);
    let dbLegs = 0;
    const seen = new Set<number>();
    run(model, 20, env(), () =>
      model.particles.forEach((p, i) => {
        if (p.alive && p.leg === 'db' && !seen.has(i * 1e6 + Math.floor(p.seed * 1e6))) {
          seen.add(i * 1e6 + Math.floor(p.seed * 1e6));
          dbLegs++;
        }
      }),
    );
    const share = dbLegs / model.spawned;
    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.36);
  });

  it('bounces writes off a failing primary as errors', () => {
    const model = createParticles(5_000);
    let redAtDb = 0;
    run(model, 10, env({ writeFailureRatio: 1 }), () => {
      redAtDb = Math.max(redAtDb, model.particles.filter((p) => p.alive && p.leg === 'bounce' && p.write && p.error).length);
    });
    expect(redAtDb).toBeGreaterThan(0);
  });

  it('swings DB traffic to a new primary smoothly instead of snapping', () => {
    const model = createParticles(500);
    run(model, 2, env());
    const promoted = { x: 2.4, y: 1, z: -7.5 };
    stepParticles(model, 0.1, env({ primary: promoted }));
    expect(model.route.primary.x).toBeGreaterThan(-2.4);
    expect(model.route.primary.x).toBeLessThan(0);
    run(model, 3, env({ primary: promoted }));
    expect(model.route.primary.x).toBeCloseTo(2.4, 1);
    const inFlight = model.particles.find((p) => p.alive && p.dbTarget === 'primary');
    if (inFlight) expect(destination(model, inFlight)).toBe(model.route.primary);
  });

  it('fizzles requests red when there is no Ready pod', () => {
    const model = createParticles(500);
    run(model, 1, env({ readyTargets: [] }));
    const alive = model.particles.filter((p) => p.alive);
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.every((p) => p.leg === 'fizzle' && p.error)).toBe(true);
  });

  it('places particles on a lifted curve between their endpoints, with optional bunching', () => {
    const model = createParticles(10);
    run(model, 0.5, env());
    const p = model.particles.find((x) => x.alive)!;
    p.t = 0;
    const out = { x: 0, y: 0, z: 0 };
    expect(particlePosition(model, p, out)).toEqual(p.from);
    p.t = 0.52; // off a node of the bunching wave
    const mid = particlePosition(model, p, { x: 0, y: 0, z: 0 });
    expect(mid.y).toBeGreaterThan(Math.max(p.from.y, p.to.y));
    const bunched = particlePosition(model, p, { x: 0, y: 0, z: 0 }, 0.8);
    expect(bunched).not.toEqual(mid);
  });
});
