import { createRng, type Rng } from '../sim/rng.ts';
import type { Vec3 } from './layout.ts';

// Requests drawn as particles: ingress → a Ready pod → (sometimes) the database. Plain numbers,
// no three.js, so the behaviour is unit-tested; the scene only copies positions into a mesh.

export type Leg = 'in' | 'db' | 'bounce' | 'fizzle';

export interface Particle {
  alive: boolean;
  leg: Leg;
  from: Vec3;
  /** Fixed destination, unless `dbTarget` routes it to a (moving) database endpoint. */
  to: Vec3;
  dbTarget: 'primary' | 'replica' | null;
  t: number;
  duration: number;
  error: boolean;
  write: boolean;
  seed: number;
}

export interface ParticleEnv {
  rps: number;
  p99: number;
  errorRatio: number;
  /** Share of DB writes failing right now (failover). */
  writeFailureRatio: number;
  readyTargets: readonly Vec3[];
  ingress: Vec3;
  primary: Vec3;
  replica: Vec3;
}

export interface ParticleModel {
  particles: Particle[];
  free: number[];
  spawnCarry: number;
  roundRobin: number;
  rng: Rng;
  /** Damped database endpoints: in-flight DB traffic swings to a new primary instead of snapping. */
  route: { primary: Vec3; replica: Vec3 };
  spawned: number;
}

/** Particles per second for each request per second (400 rps → 100 particles/s). */
export const SPAWN_PER_RPS = 0.25;
export const WRITE_SHARE = 0.2;
export const READ_TO_DB_SHARE = 0.1;
const BASE_TRAVEL_S = 1.1;
const DB_TRAVEL_S = 0.9;
const ROUTE_RATE = 2.5;
const NO_TARGET: Vec3 = { x: 0, y: 0, z: 0 };

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export function createParticles(capacity: number, seed = 7): ParticleModel {
  const particles: Particle[] = Array.from({ length: capacity }, () => ({
    alive: false,
    leg: 'in',
    from: { x: 0, y: 0, z: 0 },
    to: { x: 0, y: 0, z: 0 },
    dbTarget: null,
    t: 0,
    duration: 1,
    error: false,
    write: false,
    seed: 0,
  }));
  return {
    particles,
    free: particles.map((_, i) => capacity - 1 - i),
    spawnCarry: 0,
    roundRobin: 0,
    rng: createRng(seed),
    route: { primary: { ...NO_TARGET }, replica: { ...NO_TARGET } },
    spawned: 0,
  };
}

/** Travel time grows with tail latency: +400 ms of injected latency is roughly 4× slower. */
export function travelSeconds(p99: number): number {
  const speed = Math.min(Math.max(140 / Math.max(p99, 1), 0.22), 1);
  return BASE_TRAVEL_S / speed;
}

/** Errors the pods themselves return, excluding the failed DB writes drawn separately at the DB. */
function podErrorRatio(env: ParticleEnv): number {
  const dbShare = WRITE_SHARE * env.writeFailureRatio;
  return Math.min(Math.max((env.errorRatio - dbShare) / Math.max(1 - dbShare, 1e-6), 0), 1);
}

function spawn(model: ParticleModel, env: ParticleEnv): void {
  const index = model.free.pop();
  if (index === undefined) return;
  const p = model.particles[index]!;
  const { rng } = model;
  model.spawned++;
  p.alive = true;
  p.from = copy(env.ingress);
  p.t = 0;
  p.seed = rng.next();
  p.dbTarget = null;
  p.write = false;
  if (env.readyTargets.length === 0) {
    // No endpoints: requests die between the gateway and the cluster.
    p.leg = 'fizzle';
    p.error = true;
    p.to = { x: env.ingress.x * 0.5, y: env.ingress.y + 0.6, z: env.ingress.z * 0.5 };
    p.duration = BASE_TRAVEL_S * 0.6;
    return;
  }
  p.leg = 'in';
  p.to = copy(env.readyTargets[model.roundRobin++ % env.readyTargets.length]!);
  p.error = rng.next() < podErrorRatio(env);
  p.duration = travelSeconds(env.p99) * (0.85 + 0.3 * rng.next());
}

function arrive(model: ParticleModel, p: Particle, index: number, env: ParticleEnv): void {
  const { rng } = model;
  const retire = () => {
    p.alive = false;
    model.free.push(index);
  };

  if (p.leg === 'in' && p.error) {
    p.leg = 'bounce';
    p.from = copy(p.to);
    p.to = copy(env.ingress);
    p.t = 0;
    p.duration *= 0.6;
    return;
  }
  if (p.leg === 'in') {
    const roll = rng.next();
    const toDb = roll < WRITE_SHARE ? 'primary' : roll < WRITE_SHARE + READ_TO_DB_SHARE ? 'replica' : null;
    if (!toDb) return retire();
    p.leg = 'db';
    p.write = toDb === 'primary';
    p.dbTarget = toDb;
    p.from = copy(p.to);
    p.t = 0;
    p.duration = DB_TRAVEL_S * (0.85 + 0.3 * rng.next());
    return;
  }
  if (p.leg === 'db' && p.write && rng.next() < env.writeFailureRatio) {
    // Writes hit a primary that isn't there and bounce back to the pod, red.
    p.error = true;
    p.leg = 'bounce';
    const at = model.route.primary;
    p.to = copy(p.from);
    p.from = copy(at);
    p.dbTarget = null;
    p.t = 0;
    p.duration = DB_TRAVEL_S * 0.7;
    return;
  }
  retire();
}

export function stepParticles(model: ParticleModel, dtSeconds: number, env: ParticleEnv): void {
  const k = 1 - Math.exp(-ROUTE_RATE * dtSeconds);
  for (const key of ['primary', 'replica'] as const) {
    const r = model.route[key];
    const target = env[key];
    if (r.x === 0 && r.y === 0 && r.z === 0) Object.assign(r, target);
    r.x += (target.x - r.x) * k;
    r.y += (target.y - r.y) * k;
    r.z += (target.z - r.z) * k;
  }

  model.spawnCarry += env.rps * SPAWN_PER_RPS * dtSeconds;
  while (model.spawnCarry >= 1) {
    model.spawnCarry -= 1;
    spawn(model, env);
  }

  model.particles.forEach((p, index) => {
    if (!p.alive) return;
    p.t += dtSeconds / p.duration;
    if (p.t >= 1) arrive(model, p, index, env);
  });
}

export function destination(model: ParticleModel, p: Particle): Vec3 {
  return p.dbTarget ? model.route[p.dbTarget] : p.to;
}

/**
 * Position along a lifted quadratic curve. `bunching` (0..1) bends progress so particles crowd
 * together, used when latency is injected.
 */
export function particlePosition(model: ParticleModel, p: Particle, out: Vec3, bunching = 0): Vec3 {
  const waves = 6;
  const t = Math.min(Math.max(p.t + (bunching * Math.sin(2 * Math.PI * waves * p.t)) / (2 * Math.PI * waves), 0), 1);
  const to = destination(model, p);
  const lift = p.leg === 'db' ? 1.4 : 2.2;
  const cx = (p.from.x + to.x) / 2;
  const cy = Math.max(p.from.y, to.y) + lift;
  const cz = (p.from.z + to.z) / 2;
  const u = 1 - t;
  out.x = u * u * p.from.x + 2 * u * t * cx + t * t * to.x;
  out.y = u * u * p.from.y + 2 * u * t * cy + t * t * to.y;
  out.z = u * u * p.from.z + 2 * u * t * cz + t * t * to.z;
  return out;
}

export const aliveCount = (model: ParticleModel) => model.particles.length - model.free.length;
