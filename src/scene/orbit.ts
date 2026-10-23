// Scroll-linked camera move for the hero: as the visitor scrolls toward the infra section the camera
// swings around the cluster and rises a little, keeping its distance to the look-at point.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ORBIT_AZIMUTH_RAD = (20 * Math.PI) / 180;
export const ORBIT_ELEVATION_RAD = (8 * Math.PI) / 180;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** Camera position at scroll progress `p` (0 = the hero's own framing, 1 = full orbit), written into `out`. */
export function orbitCamera(base: Vec3, target: Vec3, p: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const t = clamp01(p);
  if (t === 0) {
    out.x = base.x;
    out.y = base.y;
    out.z = base.z;
    return out;
  }
  const dx = base.x - target.x;
  const dy = base.y - target.y;
  const dz = base.z - target.z;
  const radius = Math.hypot(dx, dy, dz);
  const azimuth = Math.atan2(dx, dz) + ORBIT_AZIMUTH_RAD * t;
  const elevation = Math.atan2(dy, Math.hypot(dx, dz)) + ORBIT_ELEVATION_RAD * t;
  out.x = target.x + radius * Math.cos(elevation) * Math.sin(azimuth);
  out.y = target.y + radius * Math.sin(elevation);
  out.z = target.z + radius * Math.cos(elevation) * Math.cos(azimuth);
  return out;
}
