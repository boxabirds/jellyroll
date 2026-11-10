/*
 * Adapted from Jelly Baby by Scott Sun (https://github.com/scottstts/Jelly-Baby),
 * src/graphics/scene/environment.ts. GPL-3.0-only; see LICENSE and NOTICE.md.
 * Changes: day environment only; intensity is a parameter.
 */
import * as THREE from 'three/webgpu';
import { STUDIO_ENVIRONMENT } from './studio-environment.generated.ts';

const RGBA_CHANNELS = 4;
const HALF_FLOAT_BYTES = 2;

export async function loadEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, intensity: number) {
  const metadata = STUDIO_ENVIRONMENT;
  const response = await fetch(new URL('../assets/bg_room_studio.rgba16f', import.meta.url));
  if (!response.ok) throw new Error(`Could not load the studio environment (${response.status})`);
  const bytes = await response.arrayBuffer(), expected = metadata.width * metadata.height * RGBA_CHANNELS * HALF_FLOAT_BYTES;
  if (bytes.byteLength !== expected) throw new Error(`studio environment has ${bytes.byteLength} bytes; expected ${expected}`);
  const source = new THREE.DataTexture(new Uint16Array(bytes), metadata.width, metadata.height, THREE.RGBAFormat, THREE.HalfFloatType);
  source.minFilter = source.magFilter = THREE.LinearFilter; source.generateMipmaps = false; source.flipY = false; source.needsUpdate = true;
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.LinearSRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(source); pmrem.dispose();
  scene.environment = target.texture; scene.environmentIntensity = intensity;
  return {
    /** Unit vector from the scene toward the key light. */
    toLight: new THREE.Vector3(...metadata.incoming).negate().normalize(),
    color: new THREE.Color().setRGB(...metadata.color, THREE.LinearSRGBColorSpace),
    intensity,
    reflectionTexture: source,
    dispose: () => { target.dispose(); source.dispose(); },
  };
}
