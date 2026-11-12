/**
 * The pool the designer shows the water in: a bowl of sand with a shore all round it, pebbles and rocks on the floor
 * so the refraction has something to bend, and grass above the waterline. The water level is 0.
 */
import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, positionWorld, smoothstep, time, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { valueNoise2 } from '../game/noise.ts';
import { waterSettings } from '../water/params.ts';

export const WATER_LEVEL = 0;
/** Radius of the pool at the waterline, how deep it is in the middle, and how steeply the shore climbs. */
export const POOL_RADIUS = 9;
export const POOL_DEPTH = 2.4;
const SHORE_RISE = 0.3;
const FIELD = 60;
const SEGMENTS = 240;
const NOISE_SEED = 77;

/** Height of the ground at (x, z). */
export function bedHeight(x: number, z: number): number {
  const r = Math.hypot(x, z) / POOL_RADIUS;
  // A smooth bowl that crosses the waterline at the pool radius, then rises gently to a bank.
  const beyond = Math.max(0, r - 1) * POOL_RADIUS;
  const bowl = r < 1 ? -POOL_DEPTH * (1 - r * r) * (1 - r * r * 0.2) : SHORE_RISE * beyond + 0.03 * beyond * beyond;
  const lumps = (valueNoise2(x * 0.45, z * 0.45, NOISE_SEED) - 0.5) * 0.45 + (valueNoise2(x * 1.6, z * 1.6, NOISE_SEED + 1) - 0.5) * 0.12;
  const shoreShare = Math.min(1, Math.max(0, r * 1.15 - 0.2));
  return bowl + lumps * (0.25 + 0.5 * shoreShare) * (r < 1 ? 1 : Math.min(1, 0.35 + beyond * 0.15));
}

export function createBed(): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(FIELD, FIELD, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) position.setY(i, bedHeight(position.getX(i), position.getZ(i)));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const xz = positionWorld.xz;
  const height = positionWorld.y;
  const pebbles = mx_noise_float(vec3(xz.mul(2.6), 3.1)).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(xz.mul(11), 9.7)).mul(0.5).add(0.5);
  const sand = mix(vec3(0.38, 0.31, 0.2), vec3(0.52, 0.44, 0.3), fine);
  const wetSand = vec3(0.2, 0.16, 0.11);
  const stone = mix(vec3(0.2, 0.19, 0.18), vec3(0.34, 0.32, 0.29), fine);
  const grass = mix(vec3(0.1, 0.2, 0.05), vec3(0.18, 0.3, 0.08), fine);
  const underwater = smoothstep(0.15, -0.25, height);
  const shore = smoothstep(0.1, 0.55, height);
  const upland = smoothstep(0.5, 1.6, height);
  let albedo = mix(sand, stone, smoothstep(0.58, 0.8, pebbles).mul(underwater.oneMinus().mul(0.4).add(0.6)));
  albedo = mix(albedo, wetSand, underwater.mul(0.6));
  albedo = mix(albedo, mix(sand, grass, shore), shore);
  albedo = mix(albedo, grass, upland);
  // Caustics: the moving net of light on the bed under the water, brighter in the shallows.
  const strength = waterSettings.num('causticStrength') as unknown as Node<'float'>;
  const scale = waterSettings.num('causticScale') as unknown as Node<'float'>;
  const speed = waterSettings.num('causticSpeed') as unknown as Node<'float'>;
  const t = time.mul(speed);
  const netA = float(1).sub(mx_noise_float(vec3(xz.mul(scale), t)).abs()).pow(6);
  const netB = float(1).sub(mx_noise_float(vec3(xz.mul(scale.mul(1.9)).add(13), t.mul(1.3))).abs()).pow(6);
  const depthFade = smoothstep(-3.2, -0.05, height).mul(smoothstep(0.1, -0.1, height));
  const caustics = netA.add(netB).mul(strength).mul(depthFade);
  material.colorNode = albedo as unknown as Node<'vec3'>;
  material.emissiveNode = vec3(0.9, 1, 0.95).mul(caustics).mul(albedo.mul(0.3).add(0.05)) as unknown as Node<'vec3'>;
  const bed = new THREE.Mesh(geometry, material);
  group.add(bed);
  // A few rocks on the floor and the shore.
  const rockGeometry = new THREE.IcosahedronGeometry(1, 2);
  const rockPosition = rockGeometry.attributes.position;
  for (let i = 0; i < rockPosition.count; i++) {
    const s = 1 + (valueNoise2(rockPosition.getX(i) * 1.7 + 3, rockPosition.getY(i) * 1.7 + rockPosition.getZ(i), NOISE_SEED + 5) - 0.5) * 0.5;
    rockPosition.setXYZ(i, rockPosition.getX(i) * s, rockPosition.getY(i) * s * 0.7, rockPosition.getZ(i) * s);
  }
  rockGeometry.computeVertexNormals();
  const rockMaterial = new THREE.MeshStandardNodeMaterial({ color: '#8a867e', roughness: 0.9 });
  const ROCKS: [number, number, number][] = [[-3.2, 2.5, 0.7], [2.2, -3.4, 0.9], [4.8, 3.1, 0.55], [-5.2, -3.5, 1.1], [0.8, 5.4, 0.45], [-1.4, -1.8, 0.4], [6.5, -0.8, 0.6], [-6.8, 1.2, 0.5]];
  for (const [x, z, size] of ROCKS) {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    rock.scale.setScalar(size);
    rock.position.set(x, bedHeight(x, z) + size * 0.25, z);
    rock.rotation.y = x * 1.3;
    group.add(rock);
  }
  return group;
}
