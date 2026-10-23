import { describe, expect, it } from 'vitest';
import {
  BURN_RATE_PAGE,
  DB_PRIMARY_DOWN_MS,
  DB_PROMOTING_MS,
  DB_RECONNECTING_MS,
  HPA_MAX_REPLICAS,
  HPA_MIN_REPLICAS,
  HPA_SCALE_DOWN_STABILIZATION_MS,
  HPA_TARGET_UTILIZATION,
  READINESS_INITIAL_DELAY_MS,
  READINESS_PERIOD_MS,
} from '../sim/config.ts';
import { highlightLine, REAL_CONFIG } from './real-config.ts';

const text = (key: keyof typeof REAL_CONFIG) => REAL_CONFIG[key].files.map((f) => f.body).join('\n') + REAL_CONFIG[key].intro;

describe('real config matches the simulation', () => {
  // If a simulator constant changes, these fail and the copy must be revisited too.
  it('pins the numbers the copy depends on', () => {
    expect([READINESS_INITIAL_DELAY_MS, READINESS_PERIOD_MS]).toEqual([3_000, 2_000]);
    expect([HPA_MIN_REPLICAS, HPA_MAX_REPLICAS, HPA_TARGET_UTILIZATION, HPA_SCALE_DOWN_STABILIZATION_MS]).toEqual([3, 10, 0.6, 300_000]);
    expect(BURN_RATE_PAGE).toBe(14.4);
    expect(DB_PRIMARY_DOWN_MS + DB_PROMOTING_MS + DB_RECONNECTING_MS).toBe(24_000);
  });

  it('shows the readiness probe, HPA and PDB the simulation models', () => {
    const workload = text('workload');
    expect(workload).toContain('initialDelaySeconds: 3');
    expect(workload).toContain('periodSeconds: 2');
    expect(workload).toContain('minReplicas: 3');
    expect(workload).toContain('maxReplicas: 10');
    expect(workload).toContain('averageUtilization: 60');
    expect(workload).toContain('stabilizationWindowSeconds: 300');
    expect(workload).toContain('kind: PodDisruptionBudget');
  });

  it('shows the production burn-rate rule and the demo compression', () => {
    const slo = text('slo');
    expect(slo).toContain('slo:sli_error:ratio_rate1h > (14.4 * 0.001)');
    expect(slo).toContain('slo:sli_error:ratio_rate6h > (6 * 0.001)');
    expect(slo).toContain('severity: page');
    expect(slo).toContain('60 s / 5 s');
  });

  it('describes the CloudNativePG cluster and the failover timing', () => {
    const db = text('database');
    expect(db).toContain('instances: 2');
    expect(db).toContain('failoverDelay: 0');
    expect(db).toContain('~24 s');
  });
});

describe('highlightLine', () => {
  it('splits keys, values and trailing comments', () => {
    expect(highlightLine('  minReplicas: 3')).toEqual([
      { text: '  ', kind: 'plain' },
      { text: 'minReplicas', kind: 'key' },
      { text: ': 3', kind: 'plain' },
    ]);
    expect(highlightLine('        - maxSkew: 1')).toEqual([
      { text: '        - ', kind: 'plain' },
      { text: 'maxSkew', kind: 'key' },
      { text: ': 1', kind: 'plain' },
    ]);
    expect(highlightLine('  failoverDelay: 0   # promote now')).toEqual([
      { text: '  ', kind: 'plain' },
      { text: 'failoverDelay', kind: 'key' },
      { text: ': 0  ', kind: 'plain' },
      { text: ' # promote now', kind: 'comment' },
    ]);
    expect(highlightLine('# Requests per second')).toEqual([{ text: '# Requests per second', kind: 'comment' }]);
    expect(highlightLine('sum(rate(x[1m]))')).toEqual([{ text: 'sum(rate(x[1m]))', kind: 'plain' }]);
  });
});
