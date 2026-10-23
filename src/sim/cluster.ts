import {
  APP_WARMUP_MS,
  CONTAINER_CREATING_MS,
  DEPLOYMENT_NAME,
  INITIAL_REPLICAS,
  K8S_NAME_ALPHABET,
  NODE_CAPACITY_PODS,
  PENDING_MS,
  READINESS_INITIAL_DELAY_MS,
  READINESS_PERIOD_MS,
  TERMINATING_MS,
  ZONES,
} from './config.ts';
import type { Rng } from './rng.ts';
import type { ClusterNode, Deployment, Pod, PodStatus, SimState, TickContext } from './types.ts';

const between = (rng: Rng, [min, max]: readonly [number, number]) => rng.range(min, max);
const NAME_CHARS = [...K8S_NAME_ALPHABET];

export function k8sName(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += rng.pick(NAME_CHARS);
  return out;
}

export function initialCluster(
  rng: Rng,
  t: number,
): Pick<SimState, 'rsHash' | 'nodes' | 'deployment' | 'pods'> {
  const rsHash = k8sName(rng, 10);
  const nodes: ClusterNode[] = ZONES.map((zone) => ({
    id: `node-${zone}`,
    zone,
    capacityPods: NODE_CAPACITY_PODS,
    ready: true,
  }));
  const deployment: Deployment = { name: DEPLOYMENT_NAME, desiredReplicas: INITIAL_REPLICAS };

  // The page opens on a cluster that has been healthy for an hour.
  const age = 3_600_000;
  const pods: Pod[] = [];
  for (let i = 0; i < INITIAL_REPLICAS; i++) {
    pods.push({
      id: newPodId(rsHash, rng, pods),
      nodeId: nodes[i % nodes.length]!.id,
      status: 'Ready',
      createdAt: t - age,
      statusSince: t - age,
      statusEndsAt: Number.POSITIVE_INFINITY,
      appReadyAt: t - age,
      nextProbeAt: null,
      readyAt: t - age,
      schedulingFailed: false,
    });
  }
  return { rsHash, nodes, deployment, pods };
}

function newPodId(rsHash: string, rng: Rng, existing: readonly Pod[]): string {
  for (;;) {
    const id = `${DEPLOYMENT_NAME}-${rsHash}-${k8sName(rng, 5)}`;
    if (!existing.some((p) => p.id === id)) return id;
  }
}

function setStatus(pod: Pod, to: PodStatus, since: number, ctx: TickContext) {
  const from = pod.status;
  pod.status = to;
  pod.statusSince = since;
  ctx.emit({ type: 'podPhaseChanged', t: ctx.t, podId: pod.id, from, to });
}

function createPod(state: SimState, ctx: TickContext): Pod {
  const pod: Pod = {
    id: newPodId(state.rsHash, ctx.rng, state.pods),
    nodeId: null,
    status: 'Pending',
    createdAt: ctx.t,
    statusSince: ctx.t,
    statusEndsAt: ctx.t + between(ctx.rng, PENDING_MS),
    appReadyAt: null,
    nextProbeAt: null,
    readyAt: null,
    schedulingFailed: false,
  };
  state.pods.push(pod);
  ctx.emit({ type: 'podCreated', t: ctx.t, pod: { ...pod } });
  ctx.log('k8s', 'info', `Created pod/${pod.id} (replicaset/${DEPLOYMENT_NAME}-${state.rsHash})`);
  return pod;
}

function terminate(pod: Pod, ctx: TickContext) {
  setStatus(pod, 'Terminating', ctx.t, ctx);
  pod.statusEndsAt = ctx.t + between(ctx.rng, TERMINATING_MS);
  pod.nextProbeAt = null;
}

/** Spread across zones first, then across nodes; ties broken by name so runs stay deterministic. */
function pickNode(state: SimState): ClusterNode | null {
  const bound = state.pods.filter((p) => p.nodeId !== null && p.status !== 'Terminating');
  const perNode = (id: string) => bound.filter((p) => p.nodeId === id).length;
  const perZone = (zone: string) =>
    bound.filter((p) => state.nodes.find((n) => n.id === p.nodeId)?.zone === zone).length;

  const candidates = state.nodes
    .filter((n) => n.ready && perNode(n.id) < n.capacityPods)
    .sort((a, b) => perZone(a.zone) - perZone(b.zone) || perNode(a.id) - perNode(b.id) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

function advancePod(state: SimState, pod: Pod, ctx: TickContext) {
  const { t, rng } = ctx;
  switch (pod.status) {
    case 'Pending': {
      if (t < pod.statusEndsAt) return;
      const node = pickNode(state);
      if (!node) {
        if (!pod.schedulingFailed) {
          pod.schedulingFailed = true;
          ctx.log(
            'k8s',
            'warn',
            `FailedScheduling pod/${pod.id}: 0/${state.nodes.length} nodes available (insufficient pod capacity)`,
          );
        }
        return;
      }
      // A pod that waited for capacity starts now; otherwise phases chain on logical time.
      const since = pod.schedulingFailed ? t : pod.statusEndsAt;
      pod.nodeId = node.id;
      setStatus(pod, 'ContainerCreating', since, ctx);
      pod.statusEndsAt = since + between(rng, CONTAINER_CREATING_MS);
      ctx.log('k8s', 'info', `Scheduled pod/${pod.id} to ${node.id}`);
      return;
    }
    case 'ContainerCreating': {
      if (t < pod.statusEndsAt) return;
      const since = pod.statusEndsAt;
      setStatus(pod, 'Running', since, ctx);
      pod.statusEndsAt = Number.POSITIVE_INFINITY;
      pod.appReadyAt = since + between(rng, APP_WARMUP_MS);
      pod.nextProbeAt = since + READINESS_INITIAL_DELAY_MS;
      return;
    }
    case 'Running': {
      // readinessProbe fires at initialDelay, then every period, and passes once the app is up.
      while (pod.nextProbeAt !== null && pod.nextProbeAt <= t) {
        if (pod.appReadyAt !== null && pod.nextProbeAt >= pod.appReadyAt) {
          pod.readyAt = pod.nextProbeAt;
          setStatus(pod, 'Ready', pod.nextProbeAt, ctx);
          pod.nextProbeAt = null;
          ctx.log('k8s', 'ok', `pod/${pod.id} Ready (readiness probe passed)`);
          return;
        }
        pod.nextProbeAt += READINESS_PERIOD_MS;
      }
      return;
    }
    case 'Terminating': {
      if (t < pod.statusEndsAt) return;
      state.pods.splice(state.pods.indexOf(pod), 1);
      ctx.emit({ type: 'podDeleted', t, podId: pod.id });
      ctx.log('k8s', 'info', `Deleted pod/${pod.id}`);
      return;
    }
    case 'Ready':
      return;
  }
}

// ReplicaSet controller prefers to delete pods that are least far along, newest first.
const DELETE_RANK: Record<PodStatus, number> = {
  Pending: 0,
  ContainerCreating: 1,
  Running: 2,
  Ready: 3,
  Terminating: 4,
};

/** One reconcile pass: kubelet/scheduler progress, then the ReplicaSet makes actual match desired. */
export function reconcileCluster(state: SimState, ctx: TickContext) {
  for (const pod of [...state.pods]) advancePod(state, pod, ctx);

  const active = state.pods.filter((p) => p.status !== 'Terminating');
  const missing = state.deployment.desiredReplicas - active.length;
  if (missing > 0) {
    for (let i = 0; i < missing; i++) createPod(state, ctx);
  } else if (missing < 0) {
    [...active]
      .sort((a, b) => DELETE_RANK[a.status] - DELETE_RANK[b.status] || b.createdAt - a.createdAt)
      .slice(0, -missing)
      .forEach((pod) => terminate(pod, ctx));
  }
}

/** Chaos: delete a pod the way `kubectl delete pod` does. Returns the victim, or null if there is none. */
export function killPod(state: SimState, ctx: TickContext, podId?: string): Pod | null {
  const alive = state.pods.filter((p) => p.status !== 'Terminating');
  let target: Pod | undefined;
  if (podId) {
    target = alive.find((p) => p.id === podId);
  } else {
    // Prefer a Ready pod so the kill visibly costs capacity; sort first so the seeded pick is stable.
    const ready = alive.filter((p) => p.status === 'Ready');
    const pool = (ready.length > 0 ? ready : alive).sort((a, b) => a.id.localeCompare(b.id));
    target = pool.length > 0 ? ctx.rng.pick(pool) : undefined;
  }
  if (!target) return null;

  ctx.startChaos('killPod', { durationMs: 0, target: target.id });
  ctx.log('chaos', 'warn', `Deleted pod/${target.id} (chaos: kill pod)`);
  terminate(target, ctx);
  return target;
}
