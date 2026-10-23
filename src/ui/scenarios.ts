import type { Command } from '../sim/types.ts';
import { commandFor, type ActionId } from './view-models.ts';

// Shareable links into the control room. #tour starts the guided tour; #scenario=<name> opens the
// console and runs one chaos action. Names come from an allowlist: anything else just opens the console.

export const SCENARIOS = {
  'pod-kill': 'killPod',
  'error-burst': 'injectErrors',
  surge: 'trafficSurge',
  latency: 'injectLatency',
  'db-failover': 'failoverDatabase',
} as const satisfies Record<string, ActionId>;

export type ScenarioName = keyof typeof SCENARIOS;

export type DeepLink = { kind: 'console' } | { kind: 'tour' } | { kind: 'scenario'; name: ScenarioName; command: Command };

const isScenario = (name: string): name is ScenarioName => Object.hasOwn(SCENARIOS, name);

export function parseDeepLink(hash: string): DeepLink | null {
  if (hash === '#console') return { kind: 'console' };
  if (hash === '#tour') return { kind: 'tour' };
  if (!hash.startsWith('#scenario=')) return null;
  const name = hash.slice('#scenario='.length);
  return isScenario(name) ? { kind: 'scenario', name, command: commandFor(SCENARIOS[name]) } : { kind: 'console' };
}
