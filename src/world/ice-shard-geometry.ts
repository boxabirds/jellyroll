/**
 * Ice shards are not cones: they are irregular, jagged crystals, tapering unevenly to a tip that is off to one
 * side, with ragged rings of different sizes and a lean. Each call builds one such shard (unit height, about unit
 * radius at its base, base at y = 0) from a seed, flat-shaded so every facet catches the light on its own.
 */
import * as THREE from 'three/webgpu';

const TAU = Math.PI * 2;
const MIN_SIDES = 5;
const SIDE_VARIETY = 3;
/** Rings up the shard: height, and the least and most their radius can be at that height. */
const RINGS = [
  { y: 0, min: 0.65, max: 1.25 },
  { y: 0.3, min: 0.5, max: 0.95 },
  { y: 0.62, min: 0.25, max: 0.6 },
  { y: 0.84, min: 0.08, max: 0.3 },
] as const;
/** How far each vertex may be pushed round its ring, as a fraction of the gap between vertices. */
const ANGLE_JITTER = 0.4;
/** How far the rings' centres wander sideways, per ring up, and the tip's own offset. */
const LEAN_PER_RING = 0.12;
const TIP_OFFSET = 0.22;
const TIP_HEIGHT_MIN = 0.92;
const TIP_HEIGHT_RANGE = 0.14;

function random(seed: number) {
  let state = (Math.imul(seed + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createJaggedShard(seed: number): THREE.BufferGeometry {
  const next = random(seed);
  const sides = MIN_SIDES + Math.floor(next() * SIDE_VARIETY);
  const rings: THREE.Vector3[][] = [];
  const leanX = (next() - 0.5) * 2, leanZ = (next() - 0.5) * 2;
  RINGS.forEach((ring, k) => {
    const points: THREE.Vector3[] = [];
    // The same vertices start each ring off at its own angle, so the facets are twisted and uneven.
    const twist = next() * 0.6;
    for (let i = 0; i < sides; i++) {
      const angle = ((i + (next() - 0.5) * 2 * ANGLE_JITTER) / sides) * TAU + twist * k;
      const radius = ring.min + (ring.max - ring.min) * next();
      points.push(new THREE.Vector3(Math.cos(angle) * radius + leanX * LEAN_PER_RING * k, ring.y, Math.sin(angle) * radius + leanZ * LEAN_PER_RING * k));
    }
    rings.push(points);
  });
  const tip = new THREE.Vector3(
    leanX * LEAN_PER_RING * RINGS.length + (next() - 0.5) * 2 * TIP_OFFSET, TIP_HEIGHT_MIN + TIP_HEIGHT_RANGE * next(),
    leanZ * LEAN_PER_RING * RINGS.length + (next() - 0.5) * 2 * TIP_OFFSET,
  );
  const positions: number[] = [];
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
      // Either diagonal, at random: the facets are not regular.
      if (next() < 0.5) { triangle(a, b, c); triangle(a, c, d); } else { triangle(a, b, d); triangle(b, c, d); }
    }
  }
  const top = rings[rings.length - 1];
  for (let i = 0; i < sides; i++) triangle(top[i], top[(i + 1) % sides], tip);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
