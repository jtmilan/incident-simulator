// Where things sit in the scene, as plain numbers (no three.js), so it can be unit tested.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Node platforms on a shallow arc facing the camera. */
export const NODE_CENTRES: Record<string, Vec3> = {
  'node-a': { x: -6.2, y: 0, z: 0.6 },
  'node-b': { x: 0, y: 0, z: -0.8 },
  'node-c': { x: 6.2, y: 0, z: 0.6 },
};

export const PLATFORM_TOP = 0.35;
const SLOT_SPACING = 1.25;
/** 2 × 2 pod slots per node (node capacity is 4). */
export const SLOT_OFFSETS: readonly Vec3[] = [
  { x: -0.5, y: 0, z: -0.5 },
  { x: 0.5, y: 0, z: -0.5 },
  { x: -0.5, y: 0, z: 0.5 },
  { x: 0.5, y: 0, z: 0.5 },
].map((o) => ({ x: o.x * SLOT_SPACING, y: 0, z: o.z * SLOT_SPACING }));

export const DB_CENTRES: Record<string, Vec3> = {
  'db-1': { x: -2.4, y: 0, z: -7.5 },
  'db-2': { x: 2.4, y: 0, z: -7.5 },
};

/** Where requests enter (in front of the cluster) and where unscheduled pods wait. */
export const INGRESS: Vec3 = { x: 0, y: 0.9, z: 8.5 };
export const PENDING_AREA: Vec3 = { x: 0, y: 2.6, z: 3.5 };

export interface SlotAssignment {
  nodeId: string;
  slot: number;
}

/**
 * Remembers which slot each pod occupies so a pod never jumps while it lives: a pod keeps its
 * slot, a newly scheduled pod takes the first free slot on its node, deleted pods free theirs.
 */
export class SlotBook {
  #slots = new Map<string, SlotAssignment>();

  assign(pods: readonly { id: string; nodeId: string | null }[]): ReadonlyMap<string, SlotAssignment> {
    const alive = new Set(pods.map((p) => p.id));
    for (const id of [...this.#slots.keys()]) if (!alive.has(id)) this.#slots.delete(id);

    for (const pod of pods) {
      if (pod.nodeId === null || this.#slots.has(pod.id)) continue;
      const taken = new Set([...this.#slots.values()].filter((s) => s.nodeId === pod.nodeId).map((s) => s.slot));
      const free = SLOT_OFFSETS.findIndex((_, i) => !taken.has(i));
      if (free >= 0) this.#slots.set(pod.id, { nodeId: pod.nodeId, slot: free });
    }
    return this.#slots;
  }
}

export function slotPosition(assignment: SlotAssignment): Vec3 {
  const centre = NODE_CENTRES[assignment.nodeId] ?? { x: 0, y: 0, z: 0 };
  const offset = SLOT_OFFSETS[assignment.slot] ?? { x: 0, y: 0, z: 0 };
  return { x: centre.x + offset.x, y: PLATFORM_TOP, z: centre.z + offset.z };
}
