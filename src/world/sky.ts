/**
 * A gradient sky whose horizon is the fog colour, so the hill dissolves into
 * it, plus the sun. Colours and strengths come from the biome the jelly is in
 * (biome-looks.ts) and change smoothly through a transition.
 */
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, uniform } from 'three/tsl';
import type { Atmosphere } from './biome-looks.ts';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

/** Exponent below 1 keeps the pale band wide near the horizon. */
const GRADIENT_EXPONENT = 0.55;

export class Sky {
  readonly sun = new THREE.DirectionalLight();
  private readonly zenith = uniform(new THREE.Color());
  private readonly horizon = uniform(new THREE.Color());
  private readonly fog = new THREE.Fog(0, 1, 2);
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGPURenderer;

  /** @param toLight unit vector from the scene toward the key light */
  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer, toLight: THREE.Vector3) {
    this.scene = scene;
    this.renderer = renderer;
    const height = normalWorldGeometry.y.max(0).pow(GRADIENT_EXPONENT);
    scene.backgroundNode = height.mix(this.horizon, this.zenith);
    scene.fog = this.fog;
    this.sun.position.copy(toLight);
    scene.add(this.sun);
  }

  apply(air: Atmosphere) {
    this.zenith.value.copy(air.zenith);
    this.horizon.value.copy(air.horizon);
    this.fog.color.copy(air.horizon);
    this.fog.near = VIEW_DISTANCE * air.fogStart;
    this.fog.far = VIEW_DISTANCE * air.fogEnd;
    this.sun.color.copy(air.sun);
    this.sun.intensity = air.sunIntensity;
    this.scene.environmentIntensity = air.ambient;
    this.renderer.toneMappingExposure = air.exposure;
  }
}
