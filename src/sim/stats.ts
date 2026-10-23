// Abramowitz & Stegun 7.1.26: |error| < 1.5e-7, plenty for latency tails.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** z-score of the 99th percentile. */
const Z99 = 2.3263;

/**
 * Fraction of requests slower than `threshold`, for a log-normal latency distribution
 * fitted to its p50 and p99. Used to turn "p99 is creeping toward the timeout" into errors.
 */
export function logNormalTail(p50: number, p99: number, threshold: number): number {
  // Guard a degenerate spread (p99 == p50) so sigma never reaches zero.
  const sigma = Math.log(Math.max(p99, p50 * 1.0001) / p50) / Z99;
  return 1 - normalCdf((Math.log(threshold) - Math.log(p50)) / sigma);
}
