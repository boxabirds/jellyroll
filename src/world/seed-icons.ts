/**
 * The small picture on a seed packet's label: what the seeds in it grow into where it floats. One tiny model
 * per kind of collectible (mushroom, snowball, cactus, crystal, ember), each about as big as the label's picture
 * area, standing on the label. Indexed by the biome's own index.
 */
import * as THREE from 'three/webgpu';
import { CAVE, DUNES, ICE, LAVA, MEADOW, SCREE } from '../game/biomes.ts';

const SEGMENTS = 14;
const GLOW = 0.25;

export type SeedIconKit = { materials: THREE.Material[]; make: (kind: number) => THREE.Group };

export function createSeedIconKit(): SeedIconKit {
  const materials: THREE.Material[] = [];
  const paint = (color: string, roughness = 0.45, glow = GLOW) => {
    const material = new THREE.MeshStandardNodeMaterial({ color, roughness });
    material.emissive.set(color).multiplyScalar(glow);
    materials.push(material);
    return material;
  };
  const cap = paint('#ff4d6d'), stem = paint('#fff4d6'), spot = paint('#ffffff');
  const snow = paint('#f4fbff', 0.9, 0.35);
  const cactus = paint('#3fae4c');
  const crystal = paint('#b06cff', 0.25, 0.4);
  const ore = paint('#ffc93a', 0.2, 0.8);
  const ember = paint('#ff6a00', 0.5, 1.1), core = paint('#ffd23a', 0.5, 1.4);

  const sphere = (radius: number, material: THREE.Material, x = 0, y = 0, scale: [number, number, number] = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, SEGMENTS, SEGMENTS), material);
    mesh.position.set(x, y, 0);
    mesh.scale.set(...scale);
    return mesh;
  };
  const capsule = (radius: number, length: number, material: THREE.Material, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, SEGMENTS), material);
    mesh.position.set(x, y, 0);
    return mesh;
  };

  const make = (kind: number) => {
    const group = new THREE.Group();
    if (kind === MEADOW) {
      group.add(sphere(0.2, cap, 0, 0.08, [1, 0.7, 0.55]));
      group.add(capsule(0.06, 0.12, stem, 0, -0.1));
      group.add(sphere(0.035, spot, -0.07, 0.15, [1, 1, 0.5]), sphere(0.03, spot, 0.08, 0.12, [1, 1, 0.5]));
    } else if (kind === ICE) {
      group.add(sphere(0.19, snow, 0, 0, [1, 1, 0.55]));
    } else if (kind === DUNES) {
      group.add(capsule(0.065, 0.3, cactus, 0, 0));
      group.add(capsule(0.045, 0.1, cactus, -0.13, 0.04), capsule(0.045, 0.1, cactus, 0.13, -0.02));
    } else if (kind === CAVE) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), crystal);
      gem.scale.set(0.75, 1.1, 0.5);
      group.add(gem);
    } else if (kind === SCREE) {
      const nugget = new THREE.Mesh(new THREE.OctahedronGeometry(0.19), ore);
      nugget.scale.set(1, 0.85, 0.5);
      group.add(nugget);
    } else if (kind === LAVA) {
      group.add(sphere(0.17, ember, 0, 0, [1, 1.15, 0.55]), sphere(0.09, core, 0, -0.02, [1, 1.1, 0.55]));
    }
    return group;
  };
  return { materials, make };
}
