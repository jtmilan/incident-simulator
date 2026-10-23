import type { ZONES } from './config.ts';
import type { Rng } from './rng.ts';

export type Zone = (typeof ZONES)[number];

/** kubectl-style status: Running means the container is up but not yet Ready (READY 0/1). */
export type PodStatus = 'Pending' | 'ContainerCreating' | 'Running' | 'Ready' | 'Terminating';

export interface ClusterNode {
  id: string;
  zone: Zone;
  capacityPods: number;
  ready: boolean;
}

export interface Pod {
  id: string;
  nodeId: string | null;
  status: PodStatus;
  createdAt: number;
  /** Logical time the current status began (phases chain without tick drift). */
  statusSince: number;
  /** When the current timed status ends (Pending, ContainerCreating, Terminating). */
  statusEndsAt: number;
  appReadyAt: number | null;
  nextProbeAt: number | null;
  readyAt: number | null;
  schedulingFailed: boolean;
}

export interface Deployment {
  name: string;
  desiredReplicas: number;
}

export type ChaosKind = 'killPod' | 'injectErrors' | 'injectLatency' | 'trafficSurge' | 'failoverDatabase' | 'drainNode';

export interface ChaosRun {
  id: number;
  kind: ChaosKind;
  startedAt: number;
  endsAt: number;
  intensity: number;
  target?: string;
}

export type TimelineSource = 'k8s' | 'hpa' | 'alertmanager' | 'db' | 'chaos' | 'sim';
export type Severity = 'info' | 'ok' | 'warn' | 'crit';

export interface TimelineEvent {
  seq: number;
  t: number;
  source: TimelineSource;
  severity: Severity;
  message: string;
}

export interface SimState {
  /** Simulated milliseconds since the scenario started. */
  t: number;
  seed: number;
  rsHash: string;
  nodes: ClusterNode[];
  deployment: Deployment;
  pods: Pod[];
  chaos: ChaosRun[];
  timeline: TimelineEvent[];
  counters: { pod: number; chaos: number; timeline: number };
}

export type Speed = 1 | 5;

export type Command =
  | { type: 'killPod'; podId?: string }
  | { type: 'recoverAll' }
  | { type: 'reset'; seed?: number }
  | { type: 'setSpeed'; speed: Speed };

export type SimEvent =
  | { type: 'podCreated'; t: number; pod: Pod }
  | { type: 'podPhaseChanged'; t: number; podId: string; from: PodStatus; to: PodStatus }
  | { type: 'podDeleted'; t: number; podId: string }
  | { type: 'chaosStarted'; t: number; run: ChaosRun }
  | { type: 'chaosEnded'; t: number; run: ChaosRun }
  | { type: 'timelineEvent'; t: number; entry: TimelineEvent }
  | { type: 'speedChanged'; t: number; speed: Speed }
  | { type: 'reset'; t: number; seed: number };

/** What each subsystem gets on every tick. Subsystems mutate the state they are handed. */
export interface TickContext {
  t: number;
  rng: Rng;
  emit(event: SimEvent): void;
  log(source: TimelineSource, severity: Severity, message: string): void;
  startChaos(kind: ChaosKind, options: { durationMs: number; intensity?: number; target?: string }): ChaosRun;
}
