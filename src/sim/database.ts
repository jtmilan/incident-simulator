import {
  DB_POOL_MAX,
  DB_PRIMARY_DOWN_MS,
  DB_PROMOTING_MS,
  DB_QUERY_SECONDS,
  DB_RECONNECTING_MS,
  DB_REJOIN_LAG_SPIKE_MS,
  DB_REJOIN_MS,
} from './config.ts';
import type { DbPhase, DbState, SimState, TickContext } from './types.ts';

export function initialDatabase(): DbState {
  return {
    phase: 'Healthy',
    phaseSince: 0,
    phaseEndsAt: Number.POSITIVE_INFINITY,
    instances: [
      { id: 'db-1', zone: 'a', role: 'primary', up: true },
      { id: 'db-2', zone: 'b', role: 'replica', up: true },
    ],
    writeFailureRatio: 0,
    replicationLagMs: 8,
    pool: { active: 8, idle: DB_POOL_MAX - 8, max: DB_POOL_MAX },
    rejoinAt: null,
  };
}

const primary = (db: DbState) => db.instances.find((i) => i.role === 'primary')!;
const replica = (db: DbState) => db.instances.find((i) => i.role === 'replica')!;

function enter(db: DbState, to: DbPhase, since: number, durationMs: number, ctx: TickContext) {
  const from = db.phase;
  db.phase = to;
  db.phaseSince = since;
  db.phaseEndsAt = since + durationMs;
  ctx.emit({ type: 'dbStateChanged', t: ctx.t, from, to, primary: primary(db).id });
}

/** Chaos: the primary stops answering. Returns false (and changes nothing) if a failover is already running. */
export function startFailover(state: SimState, ctx: TickContext): boolean {
  const { db } = state;
  if (db.phase !== 'Healthy' || db.rejoinAt !== null) {
    ctx.log('db', 'info', 'Failover already in progress; ignoring');
    return false;
  }
  const failed = primary(db);
  failed.up = false;
  enter(db, 'PrimaryDown', ctx.t, DB_PRIMARY_DOWN_MS, ctx);
  ctx.log('db', 'crit', `${failed.id} (primary) unreachable: readiness probe failing`);
  return true;
}

/**
 * CloudNativePG-style sequence: detect (primary down) → promote the replica → the app's pool
 * reconnects → the old primary rejoins as a replica. Writes need the primary; reads never stop.
 */
export function reconcileDatabase(state: SimState, ctx: TickContext): void {
  const { db } = state;
  const { t, rng } = ctx;

  if (db.phase !== 'Healthy' && t >= db.phaseEndsAt) {
    const at = db.phaseEndsAt;
    if (db.phase === 'PrimaryDown') {
      enter(db, 'Promoting', at, DB_PROMOTING_MS, ctx);
      ctx.log('db', 'warn', `Failing over: promoting ${replica(db).id} (failoverDelay: 0)`);
    } else if (db.phase === 'Promoting') {
      const oldPrimary = primary(db);
      const promoted = replica(db);
      promoted.role = 'primary';
      oldPrimary.role = 'replica';
      enter(db, 'Reconnecting', at, DB_RECONNECTING_MS, ctx);
      ctx.log('db', 'warn', `${promoted.id} promoted to primary; clients reconnecting`);
    } else {
      enter(db, 'Healthy', at, Number.POSITIVE_INFINITY, ctx);
      db.rejoinAt = at + DB_REJOIN_MS;
      ctx.log('db', 'ok', 'Connection pool reconnected; writes healthy');
    }
  }

  if (db.rejoinAt !== null && t >= db.rejoinAt) {
    const old = db.instances.find((i) => !i.up)!;
    old.up = true;
    db.rejoinAt = null;
    db.replicationLagMs = DB_REJOIN_LAG_SPIKE_MS;
    ctx.log('db', 'ok', `${old.id} rejoined as replica (pg_rewind)`);
  }

  // Writes fail outright until the new primary is promoted, then recover as the pool reconnects.
  db.writeFailureRatio =
    db.phase === 'PrimaryDown' || db.phase === 'Promoting'
      ? 1
      : db.phase === 'Reconnecting'
        ? Math.max(0, 1 - (t - db.phaseSince) / DB_RECONNECTING_MS)
        : 0;

  // Replication lag: catching up after a rejoin, otherwise a few milliseconds of jitter.
  const settled = 5 + rng.range(0, 15);
  db.replicationLagMs = db.replicationLagMs > settled ? db.replicationLagMs * 0.93 : settled;
  if (!replica(db).up) db.replicationLagMs = 0;

  const rps = state.traffic.last?.rps ?? 400;
  const active = db.writeFailureRatio === 1 ? 0 : Math.min(db.pool.max, Math.round(rps * DB_QUERY_SECONDS * (1 - db.writeFailureRatio)));
  db.pool = { active, idle: db.pool.max - active, max: db.pool.max };
}

export function isDatabaseSettled(state: SimState): boolean {
  return state.db.phase === 'Healthy' && state.db.rejoinAt === null && state.db.instances.every((i) => i.up);
}
