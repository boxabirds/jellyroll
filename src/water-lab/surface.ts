/**
 * The water surface for the designer: one flat grid at the water level, shaded by the shared water shader (water/material.ts).
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { buildWaterMaterial } from '../water/material.ts';
import type { Quality } from '../water/quality.ts';
import type { WaterSim } from '../water/sim.ts';
import { WATER_LEVEL } from './bed.ts';

const FIELD = 44;

export class WaterSurface {
  readonly mesh: THREE.Mesh;
  /** The direction to the sun, in the world, for the glint. */
  readonly sun = uniform(new THREE.Vector3(0.4, 0.8, 0.3).normalize());
  private readonly sim: WaterSim;
  private nodes: { value: unknown }[] = [];
  private builtFor = '';
  private segments = 0;

  constructor(sim: WaterSim, quality: Quality) {
    this.sim = sim;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardNodeMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    // A resized ripple grid has a new texture: every shader that reads it is pointed at it.
    sim.onTexture = texture => { for (const node of this.nodes) node.value = texture; };
    this.apply(quality);
  }

  /** Rebuild whatever the quality changes: the grid of triangles, and the shader (only if what it does has changed). */
  apply(quality: Quality) {
    if (quality.gridSegments !== this.segments) {
      this.segments = quality.gridSegments;
      const geometry = new THREE.PlaneGeometry(FIELD, FIELD, quality.gridSegments, quality.gridSegments);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, WATER_LEVEL, 0);
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    }
    const key = `${quality.lift}${quality.bentRefraction}${quality.fineDetail}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.material = this.buildMaterial(quality);
  }

  private buildMaterial(quality: Quality): THREE.Material {
    this.nodes = [];
    return buildWaterMaterial({ quality, sim: this.sim, uvOffset: 0.5, perVertex: false, sun: this.sun as unknown as Node<'vec3'>, nodes: this.nodes });
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
