/** A plain gradient sky whose horizon is the fog colour, so the hill dissolves into it. */
import * as THREE from 'three/webgpu';
import { color, normalWorldGeometry } from 'three/tsl';
import { VIEW_DISTANCE } from './terrain-mesh.ts';

const HORIZON_COLOR = '#d3ecf3';
const ZENITH_COLOR = '#4d9bd6';
/** Exponent below 1 keeps the pale band wide near the horizon. */
const GRADIENT_EXPONENT = 0.55;
/** Fog starts and ends at these fractions of the drawn distance. */
const FOG_START = 0.5;
const FOG_END = 0.97;

export function applySky(scene: THREE.Scene) {
  const height = normalWorldGeometry.y.max(0).pow(GRADIENT_EXPONENT);
  scene.backgroundNode = height.mix(color(HORIZON_COLOR), color(ZENITH_COLOR));
  scene.fog = new THREE.Fog(HORIZON_COLOR, VIEW_DISTANCE * FOG_START, VIEW_DISTANCE * FOG_END);
}
