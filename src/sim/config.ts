// Every timing and size the simulator uses, with where it comes from.
// See .paul research notes / README "Simulation model" for the reasoning.

/** Fixed simulation step. Commands apply on tick boundaries, so runs are frame-rate independent. */
export const TICK_MS = 100;

/** Longest real-time gap one advance() call will simulate (e.g. after a hidden tab), before speed. */
export const MAX_CATCH_UP_MS = 1_000;

export const DEPLOYMENT_NAME = 'checkout-api';
export const INITIAL_REPLICAS = 3;

export const ZONES = ['a', 'b', 'c'] as const;
export const NODE_CAPACITY_PODS = 4;

// Pod lifecycle with the image already cached on the node.
// Scheduler bind + kubelet pickup.
export const PENDING_MS: readonly [number, number] = [300, 900];
// Sandbox + container start, image cached.
export const CONTAINER_CREATING_MS: readonly [number, number] = [2_000, 3_800];
// App boot after the container starts; readiness passes on the first probe after this.
export const APP_WARMUP_MS: readonly [number, number] = [1_000, 4_000];
// readinessProbe: initialDelaySeconds: 3, periodSeconds: 2
export const READINESS_INITIAL_DELAY_MS = 3_000;
export const READINESS_PERIOD_MS = 2_000;
// terminationGracePeriod is 30 s, but a healthy app exits on SIGTERM in well under a second.
export const TERMINATING_MS: readonly [number, number] = [500, 1_000];

/** Newest timeline entries kept in memory. */
export const TIMELINE_LIMIT = 200;

// Kubernetes encodes generated name suffixes with this alphabet (no vowels, no 0/1/3).
export const K8S_NAME_ALPHABET = 'bcdfghjklmnpqrstvwxz2456789';

// ---- Traffic, latency, errors (research §4) ----
export const BASE_RPS = 400;
/** CPU request utilization calibration: 400 rps over 3 pods ≈ 45% of the CPU request. */
export const RPS_PER_POD_AT_FULL_REQUEST = BASE_RPS / 3 / 0.45;
/** The app sheds load (503) past 150% of its CPU request (limit is 2× request). */
export const SHED_UTILIZATION = 1.5;
export const CLIENT_TIMEOUT_MS = 1_000;
export const BASE_LATENCY_MS = { p50: 40, p95: 90, p99: 140 } as const;
export const BASELINE_ERROR_RATIO = 0.0002;
/** Traffic changes ease in/out with this time constant instead of jumping. */
export const SURGE_TIME_CONSTANT_MS = 2_000;
/** Seconds of 1 s metrics points kept (5 minutes). */
export const METRICS_HISTORY = 300;
export const METRICS_INTERVAL_MS = 1_000;

// ---- HPA, autoscaling/v2 defaults (research §3) ----
export const HPA_MIN_REPLICAS = 3;
export const HPA_MAX_REPLICAS = 10;
export const HPA_TARGET_UTILIZATION = 0.6;
export const HPA_SYNC_PERIOD_MS = 15_000;
export const HPA_TOLERANCE = 0.1;
export const HPA_SCALE_DOWN_STABILIZATION_MS = 300_000;

// ---- SLO and alerting (research §1) ----
export const SLO_TARGET = 0.999;
/** 30-day SLO period compressed to 1 hour for the demo (labelled in the UI). */
export const SLO_WINDOW_MS = 3_600_000;
export const SLO_WINDOW_LABEL = '30d → 1h (demo)';
/** Allowed bad requests in the compressed window: 0.1% of 400 rps for an hour. */
export const ERROR_BUDGET_REQUESTS = (1 - SLO_TARGET) * BASE_RPS * (SLO_WINDOW_MS / 1_000);
// SRE Workbook page threshold (2% of a 30-day budget in 1 h). Thresholds are rates and are kept;
// windows are shortened because the SLO period is compressed. Production rule: 1h/5m.
export const BURN_RATE_PAGE = 14.4;
export const BURN_LONG_WINDOW_MS = 60_000;
export const BURN_SHORT_WINDOW_MS = 5_000;
export const BURN_ALERT_FOR_MS = 5_000;
export const DB_PRIMARY_DOWN_FOR_MS = 3_000;
/** Demo value; kube-prometheus KubePodNotReady uses 15m. */
export const POD_NOT_READY_AFTER_MS = 30_000;

// ---- Database failover (research §5) ----
export const DB_PRIMARY_DOWN_MS = 8_000;
export const DB_PROMOTING_MS = 10_000;
export const DB_RECONNECTING_MS = 6_000;
export const DB_REJOIN_MS = 6_000;
/** Writes are 20% of checkout-api requests and need the primary. */
export const WRITE_FRACTION = 0.2;
export const DB_POOL_MAX = 20;
export const DB_QUERY_SECONDS = 0.02;
export const DB_REJOIN_LAG_SPIKE_MS = 2_500;

// ---- What "healthy" means (status strip, sparkline tones, incident close) ----
export const HEALTHY_ERROR_RATIO = 0.001;
export const HEALTHY_P99_MS = 300;

// ---- Incidents ----
/** Health must hold this long before an incident closes and the postmortem is written. */
export const INCIDENT_RECOVERY_HOLD_MS = 5_000;
