import {
  BASE_LATENCY_MS,
  BASE_RPS,
  BASELINE_ERROR_RATIO,
  CLIENT_TIMEOUT_MS,
  METRICS_HISTORY,
  METRICS_INTERVAL_MS,
  RPS_PER_POD_AT_FULL_REQUEST,
  SHED_UTILIZATION,
  SURGE_TIME_CONSTANT_MS,
  TICK_MS,
} from './config.ts';
import { logNormalTail } from './stats.ts';
import type { MetricsPoint, MetricsState, SimState, TickContext, TickTraffic, TrafficState } from './types.ts';

export function initialTraffic(): TrafficState {
  return { surgeFactor: 1, noise: 0, last: null };
}

export function initialMetrics(): MetricsState {
  return { series: [], bucket: emptyBucket() };
}

const emptyBucket = (): MetricsState['bucket'] => ({ ticks: 0, requests: 0, errors: 0, rps: 0, cpu: 0, p50: 0, p95: 0, p99: 0 });

const product = (xs: number[]) => xs.reduce((acc, x) => acc * x, 1);
const sum = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0);

/**
 * One tick of load on checkout-api. Analytic rather than per-request: rps from a wobbling
 * baseline times any surge, CPU from rps per Ready pod, latency from a queueing factor, and
 * errors from overload shedding, client timeouts and whatever the caller adds (`extraErrorRatio`).
 */
export function stepTraffic(state: SimState, ctx: TickContext, extraErrorRatio = 0): TickTraffic {
  const { traffic } = state;
  const active = state.chaos.filter((run) => run.endsAt > ctx.t);

  // Traffic eases toward the surge target rather than stepping.
  const surgeTarget = product(active.filter((r) => r.kind === 'trafficSurge').map((r) => r.intensity));
  traffic.surgeFactor += (surgeTarget - traffic.surgeFactor) * (1 - Math.exp(-TICK_MS / SURGE_TIME_CONSTANT_MS));
  traffic.noise = traffic.noise * 0.98 + ctx.rng.range(-1, 1) * 0.004;

  const baseline = BASE_RPS * (1 + 0.04 * Math.sin((2 * Math.PI * ctx.t) / 45_000)) * (1 + traffic.noise);
  const rps = baseline * traffic.surgeFactor;
  const requests = (rps * TICK_MS) / 1_000;
  const readyPods = state.pods.filter((p) => p.status === 'Ready').length;

  let tick: TickTraffic;
  if (readyPods === 0) {
    // No endpoints: every request fails at the load balancer after the client gives up.
    tick = { rps, requests, errors: requests, errorRatio: 1, cpu: 0, p50: CLIENT_TIMEOUT_MS, p95: CLIENT_TIMEOUT_MS, p99: CLIENT_TIMEOUT_MS, readyPods };
  } else {
    const cpu = rps / readyPods / RPS_PER_POD_AT_FULL_REQUEST;

    // Queueing: flat until ~60% of shed capacity, then 1/(1-ρ). Tails amplify more than the median.
    const rho = Math.min(cpu / SHED_UTILIZATION, 0.95);
    const queueing = rho <= 0.6 ? 1 : 0.4 / (1 - rho);
    const injected = sum(active.filter((r) => r.kind === 'injectLatency').map((r) => r.intensity));
    const jitter = 1 + ctx.rng.range(-0.03, 0.03);
    const p50 = (BASE_LATENCY_MS.p50 * queueing ** 0.6 + injected) * jitter;
    const p95 = (BASE_LATENCY_MS.p95 * queueing ** 0.85 + injected) * jitter;
    const p99 = (BASE_LATENCY_MS.p99 * queueing + injected) * jitter;

    const shed = cpu > SHED_UTILIZATION ? 1 - SHED_UTILIZATION / cpu : 0;
    const timeouts = logNormalTail(p50, p99, CLIENT_TIMEOUT_MS);
    const ok = (1 - BASELINE_ERROR_RATIO) * (1 - shed) * (1 - timeouts) * (1 - Math.min(Math.max(extraErrorRatio, 0), 1));
    const errorRatio = 1 - ok;
    tick = { rps, requests, errors: requests * errorRatio, errorRatio, cpu, p50, p95, p99, readyPods };
  }

  traffic.last = tick;
  return tick;
}

/** Fold ticks into 1 s points (request-weighted latency and errors) and publish them. */
export function recordMetrics(state: SimState, ctx: TickContext, tick: TickTraffic): MetricsPoint | null {
  const b = state.metrics.bucket;
  b.ticks += 1;
  b.requests += tick.requests;
  b.errors += tick.errors;
  b.rps += tick.rps;
  b.cpu += tick.cpu;
  b.p50 += tick.p50 * tick.requests;
  b.p95 += tick.p95 * tick.requests;
  b.p99 += tick.p99 * tick.requests;

  if (ctx.t % METRICS_INTERVAL_MS !== 0) return null;

  const weight = b.requests || 1;
  const point: MetricsPoint = {
    t: ctx.t,
    rps: b.rps / b.ticks,
    p50: b.p50 / weight,
    p95: b.p95 / weight,
    p99: b.p99 / weight,
    errorRatio: b.requests > 0 ? b.errors / b.requests : 0,
    cpu: b.cpu / b.ticks,
    readyPods: tick.readyPods,
    desiredReplicas: state.deployment.desiredReplicas,
  };
  state.metrics.series.push(point);
  if (state.metrics.series.length > METRICS_HISTORY) state.metrics.series.shift();
  state.metrics.bucket = emptyBucket();
  ctx.emit({ type: 'metricsTick', t: ctx.t, point });
  return point;
}
