import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { PALETTE } from './palette.ts';

// One-shot effects on top of the cluster: a pod shattering when it is killed, and a ring flash
// when a replacement passes its readiness probe. Timings from the motion reference study.

const MAX_SHARDS = 48;
const SHARDS_PER_BURST = 16;
const SHATTER_S = 0.42;
const MAX_FLASHES = 6;
const FLASH_S = 0.6;
const GOLDEN_ANGLE = 2.399963229728653;
const GRAVITY = -7;

interface Shard {
  alive: boolean;
  origin: Vector3;
  velocity: Vector3;
  color: Color;
  age: number;
  spin: number;
}

interface Flash {
  mesh: Mesh<TorusGeometry, MeshBasicMaterial>;
  age: number;
  alive: boolean;
}

export interface Effects {
  shatter(at: Vector3, color: Color): void;
  flash(at: Vector3): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

export function createEffects(scene: Scene, enabled: boolean): Effects {
  const shardGeometry = new TetrahedronGeometry(0.15);
  const shardMaterial = new MeshBasicMaterial({ toneMapped: false });
  const shardMesh = new InstancedMesh(shardGeometry, shardMaterial, MAX_SHARDS);
  shardMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  shardMesh.count = 0;
  scene.add(shardMesh);
  const shards: Shard[] = Array.from({ length: MAX_SHARDS }, () => ({
    alive: false,
    origin: new Vector3(),
    velocity: new Vector3(),
    color: new Color(),
    age: 0,
    spin: 0,
  }));

  const ringGeometry = new TorusGeometry(0.55, 0.035, 8, 48);
  const flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => {
    const mesh = new Mesh(
      ringGeometry,
      new MeshBasicMaterial({ color: new Color(PALETTE.ok).multiplyScalar(2), transparent: true, toneMapped: false, opacity: 0 }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 0, alive: false };
  });

  const dummy = new Object3D();
  const tint = new Color();
  let burst = 0;

  return {
    shatter(at, color) {
      if (!enabled) return;
      burst++;
      let placed = 0;
      for (const shard of shards) {
        if (shard.alive || placed >= SHARDS_PER_BURST) continue;
        // Golden-angle directions spread the fragments evenly without looking regular.
        const theta = (placed + burst * 3) * GOLDEN_ANGLE;
        const up = 0.35 + (placed / SHARDS_PER_BURST) * 0.9;
        shard.alive = true;
        shard.age = 0;
        shard.origin.copy(at);
        shard.velocity.set(Math.cos(theta) * 2.6, up * 3.2, Math.sin(theta) * 2.6);
        shard.color.copy(color);
        shard.spin = theta;
        placed++;
      }
    },

    flash(at) {
      if (!enabled) return;
      const flash = flashes.find((f) => !f.alive) ?? flashes[0]!;
      flash.alive = true;
      flash.age = 0;
      flash.mesh.position.set(at.x, at.y - 0.45, at.z);
      flash.mesh.visible = true;
    },

    update(dt) {
      let i = 0;
      for (const shard of shards) {
        if (!shard.alive) continue;
        shard.age += dt;
        const k = shard.age / SHATTER_S;
        if (k >= 1) {
          shard.alive = false;
          continue;
        }
        const ease = k * k; // power2.in
        dummy.position.set(
          shard.origin.x + shard.velocity.x * shard.age,
          shard.origin.y + shard.velocity.y * shard.age + 0.5 * GRAVITY * shard.age * shard.age,
          shard.origin.z + shard.velocity.z * shard.age,
        );
        dummy.rotation.set(shard.spin + shard.age * 9, shard.spin * 0.5, shard.age * 7);
        dummy.scale.setScalar(Math.max(1 - ease, 0.001));
        dummy.updateMatrix();
        shardMesh.setMatrixAt(i, dummy.matrix);
        shardMesh.setColorAt(i, tint.copy(shard.color).multiplyScalar(1 - ease * 0.8));
        i++;
      }
      shardMesh.count = i;
      shardMesh.instanceMatrix.needsUpdate = true;
      if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;

      for (const flash of flashes) {
        if (!flash.alive) continue;
        flash.age += dt;
        const k = flash.age / FLASH_S;
        if (k >= 1) {
          flash.alive = false;
          flash.mesh.visible = false;
          continue;
        }
        flash.mesh.scale.setScalar(0.6 + k);
        flash.mesh.material.opacity = (1 - k) * (1 - k);
      }
    },

    dispose() {
      shardGeometry.dispose();
      shardMaterial.dispose();
      ringGeometry.dispose();
      flashes.forEach((f) => f.mesh.material.dispose());
    },
  };
}
