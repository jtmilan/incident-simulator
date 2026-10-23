import {
  BURN_ALERT_FOR_MS,
  BURN_LONG_WINDOW_MS,
  BURN_RATE_PAGE,
  BURN_SHORT_WINDOW_MS,
  DB_PRIMARY_DOWN_MS,
  DB_PROMOTING_MS,
  DB_RECONNECTING_MS,
  HPA_SCALE_DOWN_STABILIZATION_MS,
  HPA_MAX_REPLICAS,
  HPA_MIN_REPLICAS,
  HPA_TARGET_UTILIZATION,
  INITIAL_REPLICAS,
  READINESS_INITIAL_DELAY_MS,
  READINESS_PERIOD_MS,
} from '../sim/config.ts';

// The production manifests and queries each panel stands in for. Numbers come from the simulator's
// own config, so what the drawer says is what the simulation does.

export interface ConfigFile {
  file: string;
  note?: string;
  body: string;
}

export interface ConfigSection {
  title: string;
  intro: string;
  files: ConfigFile[];
}

const s = (ms: number) => ms / 1_000;

export const REAL_CONFIG: Record<'workload' | 'slo' | 'promql' | 'database', ConfigSection> = {
  workload: {
    title: 'checkout-api: Deployment, autoscaling, disruption budget',
    intro: 'Pod lifecycle and autoscaling in the simulation follow these manifests.',
    files: [
      {
        file: 'deployment.yaml',
        note: `Readiness probe ${s(READINESS_INITIAL_DELAY_MS)} s / ${s(READINESS_PERIOD_MS)} s: a killed pod's replacement is Ready in ~5–10 s.`,
        body: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: shop
spec:
  replicas: ${INITIAL_REPLICAS}
  selector:
    matchLabels: { app: checkout-api }
  strategy:
    rollingUpdate: { maxUnavailable: 0, maxSurge: 25% }
  template:
    metadata:
      labels: { app: checkout-api }
    spec:
      topologySpreadConstraints:        # one pod per zone before doubling up
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: { app: checkout-api }
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: ghcr.io/example/checkout-api:1.42.0
          resources:
            requests: { cpu: 500m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
          readinessProbe:
            httpGet: { path: /healthz/ready, port: 8080 }
            initialDelaySeconds: ${s(READINESS_INITIAL_DELAY_MS)}
            periodSeconds: ${s(READINESS_PERIOD_MS)}
          livenessProbe:
            httpGet: { path: /healthz/live, port: 8080 }
            periodSeconds: 10`,
      },
      {
        file: 'hpa.yaml',
        note: 'The behavior block spells out the autoscaling/v2 defaults the simulation uses.',
        body: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: checkout-api
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: checkout-api }
  minReplicas: ${HPA_MIN_REPLICAS}
  maxReplicas: ${HPA_MAX_REPLICAS}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: ${Math.round(HPA_TARGET_UTILIZATION * 100)} }
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      selectPolicy: Max                 # whichever adds more pods
      policies:
        - { type: Percent, value: 100, periodSeconds: 15 }
        - { type: Pods, value: 4, periodSeconds: 15 }
    scaleDown:
      stabilizationWindowSeconds: ${s(HPA_SCALE_DOWN_STABILIZATION_MS)}   # the countdown in the health panel
      policies:
        - { type: Percent, value: 100, periodSeconds: 15 }`,
      },
      {
        file: 'pdb.yaml',
        body: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: checkout-api
spec:
  minAvailable: 2
  selector:
    matchLabels: { app: checkout-api }`,
      },
    ],
  },
  slo: {
    title: 'SLO: multi-window, multi-burn-rate alerting',
    intro:
      `Production rule from the Google SRE Workbook. The simulation compresses the 30-day window to 1 hour, so it keeps the ${BURN_RATE_PAGE}× threshold but evaluates it over ${s(BURN_LONG_WINDOW_MS)} s / ${s(BURN_SHORT_WINDOW_MS)} s windows with a ${s(BURN_ALERT_FOR_MS)} s for.`,
    files: [
      {
        file: 'checkout-api-slo.yaml',
        body: `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: checkout-api-slo
spec:
  groups:
    - name: checkout-api-slo   # SLO 99.9% over 30 days: error budget 0.1%
      rules:
        - record: slo:sli_error:ratio_rate5m
          expr: |
            sum(rate(http_requests_total{job="checkout-api",code=~"5.."}[5m]))
              / sum(rate(http_requests_total{job="checkout-api"}[5m]))
        # …same recording rule for 30m, 1h, 6h and 3d windows
        - alert: HighErrorBudgetBurn
          expr: |
            (slo:sli_error:ratio_rate1h > (${BURN_RATE_PAGE} * 0.001)
              and slo:sli_error:ratio_rate5m > (${BURN_RATE_PAGE} * 0.001))
            or
            (slo:sli_error:ratio_rate6h > (6 * 0.001)
              and slo:sli_error:ratio_rate30m > (6 * 0.001))
          labels:
            severity: page
          annotations:
            summary: checkout-api is burning its 30-day error budget too fast
        - alert: ErrorBudgetBurnSlow
          expr: |
            slo:sli_error:ratio_rate3d > 0.001
              and slo:sli_error:ratio_rate6h > 0.001
          labels:
            severity: ticket`,
      },
    ],
  },
  promql: {
    title: 'The queries behind the sparklines',
    intro: 'What each signal in the health panel would be on a real Prometheus.',
    files: [
      {
        file: 'signals.promql',
        body: `# Requests per second
sum(rate(http_requests_total{job="checkout-api"}[1m]))

# p99 latency (seconds)
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="checkout-api"}[5m])))

# Error ratio
sum(rate(http_requests_total{job="checkout-api",code=~"5.."}[5m]))
  / sum(rate(http_requests_total{job="checkout-api"}[5m]))

# CPU as a share of the request (what the HPA scales on)
sum(rate(container_cpu_usage_seconds_total{container="api",pod=~"checkout-api-.*"}[1m]))
  / sum(kube_pod_container_resource_requests{container="api",resource="cpu",pod=~"checkout-api-.*"})`,
      },
    ],
  },
  database: {
    title: 'Postgres: CloudNativePG cluster',
    intro:
      `Simulated failover: ~${s(DB_PRIMARY_DOWN_MS + DB_PROMOTING_MS + DB_RECONNECTING_MS)} s of failed writes (${s(DB_PRIMARY_DOWN_MS)} s detection, ${s(DB_PROMOTING_MS)} s promotion, ${s(DB_RECONNECTING_MS)} s reconnect) while reads continue. For comparison, AWS documents 60–120 s for an RDS Multi-AZ instance failover.`,
    files: [
      {
        file: 'checkout-db.yaml',
        body: `apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: checkout-db
spec:
  instances: 2                  # db-1 primary, db-2 replica
  failoverDelay: 0              # promote as soon as the primary is unhealthy
  switchoverDelay: 3600
  primaryUpdateStrategy: unsupervised
  affinity:
    topologyKey: topology.kubernetes.io/zone   # one instance per zone
  storage:
    size: 20Gi
  postgresql:
    parameters:
      max_connections: "200"`,
      },
    ],
  },
};

export type Segment = { text: string; kind: 'key' | 'comment' | 'plain' };

/** Splits one YAML line into key / comment / plain segments for colouring (rendered with textContent). */
export function highlightLine(line: string): Segment[] {
  if (/^\s*#/.test(line)) return [{ text: line, kind: 'comment' }];
  const segments: Segment[] = [];
  let rest = line;
  const key = /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)(:)(.*)$/.exec(line);
  if (key) {
    segments.push({ text: key[1]!, kind: 'plain' }, { text: key[2]!, kind: 'key' });
    rest = key[3]! + key[4]!;
  }
  const hash = rest.search(/\s#\s/);
  if (hash >= 0) {
    segments.push({ text: rest.slice(0, hash), kind: 'plain' }, { text: rest.slice(hash), kind: 'comment' });
  } else {
    segments.push({ text: rest, kind: 'plain' });
  }
  return segments.filter((seg) => seg.text.length > 0);
}
