import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Simulation } from '../sim/simulation.ts';
import type { Pod } from '../sim/types.ts';
import { DB_CENTRES, NODE_CENTRES, PENDING_AREA, PLATFORM_TOP, SlotBook, slotPosition } from './layout.ts';
import { heatColor, PALETTE } from './palette.ts';
import type { Quality } from './quality.ts';

export interface ClusterScene {
  update(dtMs: number, nowMs: number): void;
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

const MAX_PODS = 12;
/** Frame-rate-independent smoothing rate (≈ the reference study's λ). */
const DAMP = 6;

// Visual weight by pod status: Ready pods glow (HDR > 1 so bloom picks them up), starting pods stay dim.
const STATUS_LOOK: Record<Pod['status'], { scale: number; brightness: number }> = {
  Pending: { scale: 0.45, brightness: 0.25 },
  ContainerCreating: { scale: 0.7, brightness: 0.4 },
  Running: { scale: 0.9, brightness: 0.75 },
  Ready: { scale: 1, brightness: 1.45 },
  Terminating: { scale: 0, brightness: 0.2 },
};

interface PodVisual {
  position: Vector3;
  scale: number;
  color: Color;
  seed: number;
  gone: boolean;
}

const GRID_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Anti-aliased grid lines that fade into the background with distance.
const GRID_FRAGMENT = /* glsl */ `
  uniform vec3 uLine;
  uniform vec3 uBg;
  uniform float uCell;
  varying vec3 vWorld;
  void main() {
    vec2 coord = vWorld.xz / uCell;
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);
    float fade = 1.0 - smoothstep(6.0, 28.0, length(vWorld.xz));
    gl_FragColor = vec4(mix(uBg, uLine, line * fade), 1.0);
  }
`;

export function createClusterScene(canvas: HTMLCanvasElement, sim: Simulation, quality: Quality): ClusterScene {
  const renderer = new WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dprCap));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  scene.background = new Color(PALETTE.bg);
  scene.fog = new Fog(PALETTE.bg, 16, 38);

  const camera = new PerspectiveCamera(38, 1, 0.1, 120);
  const cameraBase = new Vector3(0, 11, 23);
  const lookAt = new Vector3(0, 0, -2.5);

  scene.add(new HemisphereLight(0xcfe8ff, PALETTE.bg, 0.7));
  const rim = new DirectionalLight(PALETTE.accent, 1.4);
  rim.position.set(-8, 6, -10);
  const key = new DirectionalLight(0xffffff, 0.8);
  key.position.set(6, 10, 8);
  scene.add(rim, key);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Grid floor.
  const gridMaterial = track(
    new ShaderMaterial({
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      uniforms: {
        uLine: { value: new Color(PALETTE.grid).multiplyScalar(1.6) },
        uBg: { value: new Color(PALETTE.bg) },
        uCell: { value: 1.5 },
      },
    }),
  );
  const floor = new Mesh(track(new PlaneGeometry(90, 90)), gridMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  // Node platforms with a glowing top edge.
  const platformGeometry = track(new RoundedBoxGeometry(3.3, PLATFORM_TOP, 3.3, 4, 0.1));
  const platformMaterial = track(new MeshStandardMaterial({ color: PALETTE.panel, roughness: 0.55, metalness: 0.25 }));
  const edgeGeometry = track(new EdgesGeometry(track(new BoxGeometry(3.3, 0.001, 3.3))));
  const edgeMaterials = new Map<string, LineBasicMaterial>();
  for (const [nodeId, centre] of Object.entries(NODE_CENTRES)) {
    const platform = new Mesh(platformGeometry, platformMaterial);
    platform.position.set(centre.x, PLATFORM_TOP / 2, centre.z);
    const edgeMaterial = track(new LineBasicMaterial({ color: new Color(PALETTE.accent).multiplyScalar(1.3), transparent: true, opacity: 0.55 }));
    const edge = new LineSegments(edgeGeometry, edgeMaterial);
    edge.position.set(centre.x, PLATFORM_TOP + 0.005, centre.z);
    edgeMaterials.set(nodeId, edgeMaterial);
    scene.add(platform, edge);
  }

  // Database: a platform with two stacked-cylinder instances and a ring over the primary.
  const dbPlatform = new Mesh(track(new RoundedBoxGeometry(8.4, 0.3, 3.4, 4, 0.1)), platformMaterial);
  dbPlatform.position.set(0, 0.15, DB_CENTRES['db-1']!.z);
  scene.add(dbPlatform);
  const diskGeometry = track(new CylinderGeometry(0.75, 0.75, 0.32, 40));
  const dbMaterials = new Map<string, MeshStandardMaterial>();
  for (const [id, centre] of Object.entries(DB_CENTRES)) {
    const material = track(
      new MeshStandardMaterial({ color: PALETTE.panel, emissive: new Color(PALETTE.accent), emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.3 }),
    );
    const stack = new Group();
    for (let i = 0; i < 3; i++) {
      const disk = new Mesh(diskGeometry, material);
      disk.position.y = 0.5 + i * 0.42;
      stack.add(disk);
    }
    stack.position.set(centre.x, 0, centre.z);
    dbMaterials.set(id, material);
    scene.add(stack);
  }
  const ringMaterial = track(new MeshBasicMaterial({ color: new Color(PALETTE.accent).multiplyScalar(2), transparent: true, toneMapped: false }));
  const ring = new Mesh(track(new TorusGeometry(1.05, 0.045, 12, 64)), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(DB_CENTRES['db-1']!.x, 2.05, DB_CENTRES['db-1']!.z);
  scene.add(ring);

  // Pods: one instanced draw call; colour carries status and CPU heat.
  const podMaterial = track(new MeshBasicMaterial({ toneMapped: false }));
  const pods = new InstancedMesh(track(new CapsuleGeometry(0.3, 0.45, 6, 16)), podMaterial, MAX_PODS);
  pods.instanceMatrix.setUsage(DynamicDrawUsage);
  pods.count = 0;
  scene.add(pods);

  // Post-processing: bloom only where the tier allows it.
  let composer: EffectComposer | null = null;
  let bloom: UnrealBloomPass | null = null;
  if (quality.bloom !== 'off') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Restrained: glow should read as 'lit', not as haze over the scene.
    bloom = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.45, 0.76);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  const slots = new SlotBook();
  const visuals = new Map<string, PodVisual>();
  const dummy = new Object3D();
  const scratch = new Color();
  let seedCounter = 0;

  const targetFor = (pod: Pod, assignment: ReturnType<SlotBook['assign']>, index: number) => {
    const slot = assignment.get(pod.id);
    if (slot) {
      const p = slotPosition(slot);
      return new Vector3(p.x, p.y + 0.55, p.z);
    }
    return new Vector3(PENDING_AREA.x + (index - 1) * 0.9, PENDING_AREA.y, PENDING_AREA.z);
  };

  function update(dtMs: number, nowMs: number) {
    const dt = Math.min(dtMs, 50) / 1_000;
    const state = sim.state;
    const cpu = sim.latest?.cpu ?? 0.45;
    const assignment = slots.assign(state.pods);
    const time = nowMs / 1_000;

    // Bring visuals in line with the simulator.
    const live = new Set<string>();
    state.pods.forEach((pod, index) => {
      live.add(pod.id);
      const target = targetFor(pod, assignment, index);
      let visual = visuals.get(pod.id);
      if (!visual) {
        visual = { position: target.clone(), scale: 0, color: new Color(PALETTE.muted), seed: seedCounter++ * 1.618, gone: false };
        visuals.set(pod.id, visual);
      }
      const look = STATUS_LOOK[pod.status];
      visual.position.x = MathUtils.damp(visual.position.x, target.x, DAMP, dt);
      visual.position.y = MathUtils.damp(visual.position.y, target.y, DAMP, dt);
      visual.position.z = MathUtils.damp(visual.position.z, target.z, DAMP, dt);
      visual.scale = MathUtils.damp(visual.scale, look.scale, DAMP, dt);
      const heat = pod.status === 'Ready' ? heatColor(cpu) : pod.status === 'Pending' ? { r: 0.5, g: 0.55, b: 0.6 } : heatColor(0.45);
      scratch.setRGB(heat.r * look.brightness, heat.g * look.brightness, heat.b * look.brightness, SRGBColorSpace);
      visual.color.lerp(scratch, 1 - Math.exp(-DAMP * dt));
    });
    // Deleted pods shrink away from where they stood.
    for (const [id, visual] of visuals) {
      if (live.has(id)) continue;
      visual.gone = true;
      visual.scale = MathUtils.damp(visual.scale, 0, DAMP * 1.5, dt);
      if (visual.scale < 0.02) visuals.delete(id);
    }

    let i = 0;
    for (const visual of visuals.values()) {
      if (i >= MAX_PODS) break;
      const bob = quality.drift && !visual.gone ? Math.sin(time * 1.4 + visual.seed) * 0.05 : 0;
      dummy.position.set(visual.position.x, visual.position.y + bob, visual.position.z);
      dummy.scale.setScalar(Math.max(visual.scale, 0.0001));
      dummy.updateMatrix();
      pods.setMatrixAt(i, dummy.matrix);
      pods.setColorAt(i, visual.color);
      i++;
    }
    pods.count = i;
    pods.instanceMatrix.needsUpdate = true;
    if (pods.instanceColor) pods.instanceColor.needsUpdate = true;

    // Nodes dim when not Ready (node drain, Phase 5).
    for (const node of state.nodes) {
      const material = edgeMaterials.get(node.id);
      if (material) material.opacity = MathUtils.damp(material.opacity, node.ready ? 0.55 : 0.12, DAMP, dt);
    }

    // Database: primary glows, replica idles, a down instance goes dark; the ring follows the primary.
    const db = state.db;
    for (const instance of db.instances) {
      const material = dbMaterials.get(instance.id);
      if (!material) continue;
      const promoting = db.phase === 'Promoting' && instance.role === 'replica' && instance.up;
      const target = !instance.up ? 0 : instance.role === 'primary' ? 1.2 : promoting ? 0.6 + 0.6 * Math.abs(Math.sin(time * 6)) : 0.3;
      material.emissiveIntensity = MathUtils.damp(material.emissiveIntensity, target, DAMP, dt);
    }
    const primary = db.instances.find((x) => x.role === 'primary');
    const ringTarget = primary ? DB_CENTRES[primary.id] : undefined;
    if (ringTarget) {
      ring.position.x = MathUtils.damp(ring.position.x, ringTarget.x, 3, dt);
      ring.position.z = MathUtils.damp(ring.position.z, ringTarget.z, 3, dt);
    }
    ringMaterial.opacity = MathUtils.damp(ringMaterial.opacity, primary?.up ? 1 : 0.15, DAMP, dt);
    ring.rotation.z += dt * 0.6;

    // Slow ambient camera drift, off for reduced motion.
    const drift = quality.drift ? 1 : 0;
    camera.position.set(
      cameraBase.x + Math.sin(time * 0.07) * 0.8 * drift,
      cameraBase.y + Math.sin(time * 0.05) * 0.25 * drift,
      cameraBase.z,
    );
    camera.lookAt(lookAt);
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  function resize(width: number, height: number) {
    const aspect = width / Math.max(height, 1);
    camera.aspect = aspect;
    // Narrow (portrait) screens pull the camera back so all three nodes stay in frame.
    const pull = aspect < 1 ? 1.7 : aspect < 1.4 ? 1.2 : 1;
    cameraBase.set(0, 11 * pull, 23 * pull);
    // On wide screens the hero copy owns the left side, so shift the cluster into the right part.
    if (aspect >= 1.2) camera.setViewOffset(width, height, -width * 0.13, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (composer && bloom) {
      composer.setSize(width, height);
      const scale = quality.bloom === 'half' ? 0.5 : 1;
      bloom.resolution.set(width * scale, height * scale);
    }
  }

  function dispose() {
    disposables.forEach((d) => d.dispose());
    composer?.dispose();
    renderer.dispose();
  }

  return { update, render, resize, dispose };
}
