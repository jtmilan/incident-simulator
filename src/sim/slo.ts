import {
  BURN_LONG_WINDOW_MS,
  BURN_SHORT_WINDOW_MS,
  ERROR_BUDGET_REQUESTS,
  SLO_TARGET,
  SLO_WINDOW_MS,
  TICK_MS,
} from './config.ts';
import type { SimState, SloState, TickTraffic } from './types.ts';

const LONG_TICKS = BURN_LONG_WINDOW_MS / TICK_MS;
const SHORT_TICKS = BURN_SHORT_WINDOW_MS / TICK_MS;

export function initialSlo(): SloState {
  return {
    target: SLO_TARGET,
    windowMs: SLO_WINDOW_MS,
    budgetTotal: ERROR_BUDGET_REQUESTS,
    budgetSpent: 0,
    budgetRemaining: 1,
    burnShort: 0,
    burnLong: 0,
    ring: { requests: [], errors: [], next: 0 },
  };
}

/** Burn rate = observed error ratio / allowed error ratio (1× spends the budget exactly over the window). */
export function burnRate(requests: number, errors: number, target = SLO_TARGET): number {
  return requests > 0 ? errors / requests / (1 - target) : 0;
}

function windowSums(ring: SloState['ring'], ticks: number) {
  const size = ring.requests.length;
  let requests = 0;
  let errors = 0;
  for (let i = 1; i <= Math.min(ticks, size); i++) {
    const idx = (ring.next - i + size) % size;
    requests += ring.requests[idx]!;
    errors += ring.errors[idx]!;
  }
  return { requests, errors };
}

/** Spend the error budget and refresh both burn-rate windows from this tick's traffic. */
export function updateSlo(state: SimState, tick: TickTraffic): void {
  const { slo } = state;
  const { ring } = slo;
  if (ring.requests.length < LONG_TICKS) {
    ring.requests.push(tick.requests);
    ring.errors.push(tick.errors);
    ring.next = ring.requests.length % LONG_TICKS;
  } else {
    ring.requests[ring.next] = tick.requests;
    ring.errors[ring.next] = tick.errors;
    ring.next = (ring.next + 1) % LONG_TICKS;
  }

  slo.budgetSpent += tick.errors;
  slo.budgetRemaining = 1 - slo.budgetSpent / slo.budgetTotal;

  const long = windowSums(ring, LONG_TICKS);
  const short = windowSums(ring, SHORT_TICKS);
  slo.burnLong = burnRate(long.requests, long.errors, slo.target);
  slo.burnShort = burnRate(short.requests, short.errors, slo.target);
}
