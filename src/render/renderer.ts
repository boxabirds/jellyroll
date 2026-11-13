/*
 * Adapted from Jelly Baby by Scott Sun (https://github.com/scottstts/Jelly-Baby),
 * src/graphics/scene/renderer.ts. GPL-3.0-only; see LICENSE and NOTICE.md.
 * Changes: canvas label, named constants, and a resize that only owns the
 * drawing buffer and aspect (the chase camera owns field of view).
 */
import * as THREE from 'three/webgpu';
import { InterruptedError, UnsupportedError } from './unsupported.ts';

/** Hard cap on physical pixels; DPR may fall below 1 on huge viewports. */
/** (Set by the performance budget: at 3 million pixels the GPU alone took a whole frame on a laptop; see scripts/perf.py.) */
const MAX_DRAWING_BUFFER_PIXELS = 2_100_000;
export const MAX_DEVICE_PIXEL_RATIO = 1.7;
const TONE_MAPPING_EXPOSURE = 1.05;

export async function createRenderer(fail: (e: unknown) => void) {
  if (!window.isSecureContext) throw new UnsupportedError('insecure', 'Please open this game over HTTPS or localhost.');
  if (!navigator.gpu) throw new UnsupportedError('no-webgpu', 'This browser does not support WebGPU (navigator.gpu is missing).');
  // A browser can have WebGPU and still no usable graphics hardware (a blocklisted GPU, acceleration turned off).
  if (!(await navigator.gpu.requestAdapter().catch(() => null))) throw new UnsupportedError('no-adapter', 'WebGPU found no graphics adapter.');
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  // r185 normally installs a WebGL fallback factory. Reject before it is invoked.
  (renderer as unknown as { _getFallback: null })._getFallback = null;
  let fatal: Error | null = null;
  const lost = renderer.onDeviceLost.bind(renderer), error = renderer.onError.bind(renderer);
  renderer.onDeviceLost = info => {
    lost(info); fatal = new Error(`WebGPU device lost: ${info.message}`); fail(fatal);
    void renderer.setAnimationLoop(null);
  };
  renderer.onError = info => {
    const gpuInfo = info as unknown as { type: string; message: string };
    error(info); fatal = new Error(`WebGPU ${gpuInfo.type}: ${gpuInfo.message}`); fail(fatal);
    void renderer.setAnimationLoop(null);
  };
  await renderer.init();
  if (fatal) throw fatal;
  if (!(renderer.backend as unknown as { isWebGPUBackend: boolean }).isWebGPUBackend) throw new Error('WebGPU is required.');
  let disposing = false;
  const dispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => { disposing = true; dispose(); };
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  void device.lost.then(info => {
    // Three forwards non-destroyed loss. A destruction outside our teardown is fatal too.
    // (The browser's own words for why are kept: on a phone they say whether it was memory or the page going to the background.)
    if (info.reason === 'destroyed' && !disposing) { fail(new InterruptedError(`WebGPU device was destroyed: ${info.message || 'no reason given'}`)); void renderer.setAnimationLoop(null); }
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Jellyland. A jelly rolls down an endless hill. W speeds it up, S slows it down, A and D steer left and right. R restarts.');
  return renderer;
}

export function drawingBufferDpr(width: number, height: number, devicePixelRatio: number, maxDpr = MAX_DEVICE_PIXEL_RATIO) {
  const dpr = Math.min(devicePixelRatio, maxDpr, Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height)));
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Phones have far less GPU than the pixel count of their screens suggests, so they draw fewer pixels. */
export const MOBILE_MAX_DEVICE_PIXEL_RATIO = 1.5;

const applied = new WeakMap<THREE.WebGPURenderer, { width: number; height: number; dpr: number }>();

export function resizeView(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, maxDpr = MAX_DEVICE_PIXEL_RATIO) {
  // The size the canvas is actually shown at, not window.innerWidth/Height: after a phone is turned, those can still hold the old
  // orientation for a moment (or differ from the page's layout size), and a buffer of the wrong shape stretches the picture.
  const canvas = renderer.domElement;
  const shownWidth = canvas.clientWidth || window.innerWidth, shownHeight = canvas.clientHeight || window.innerHeight;
  if (shownWidth <= 0 || shownHeight <= 0) return;
  const width = Math.max(1, shownWidth), height = Math.max(1, shownHeight);
  const dpr = drawingBufferDpr(width, height, window.devicePixelRatio, maxDpr);
  // A phone's toolbar sliding in and out sends many resize events: only a real change of size is worth remaking the buffers for.
  const last = applied.get(renderer);
  if (last && last.width === width && last.height === height && last.dpr === dpr) return;
  applied.set(renderer, { width, height, dpr });
  renderer.setDrawingBufferSize(width, height, dpr);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
