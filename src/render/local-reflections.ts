/*
 * Adapted from Jelly Baby by Scott Sun (https://github.com/scottstts/Jelly-Baby),
 * src/graphics/scene/local-reflections.ts. GPL-3.0-only; see LICENSE and NOTICE.md.
 * Changes: thresholds and clip planes rescaled from a 7 cm tabletop character
 * to a 1.2 m ball on a hillside, and the capture also suspends the scene's
 * procedural sky node so the HDR is what open directions reflect.
 */
import * as THREE from 'three/webgpu';

const PROBE_SIZE = 128;
const CUBE_FACES = 6;
/**
 * Re-capture once the ball has moved this far (metres): about 80% of the jelly's radius. Every completed
 * capture also rebuilds the filtered reflection map, which is expensive; at 5 cm (the original, for a 7 cm
 * baby) a running jelly recaptured every frame or two, which cost about 11 fps at 2x pixel density.
 */
const MOVE_THRESHOLD = 0.6;
const PROBE_NEAR = 0.1;
const PROBE_FAR = 600;
const DEFAULT_FACES_PER_FRAME = 4;

/** What the probe leaves out while it captures, to keep the four extra scene renders per frame cheap. */
export type ProbeCulling = {
  /** Small things that cannot be made out in a 128 pixel reflection: hidden for the capture. */
  detail: THREE.Object3D[];
  /** Called with true just before a capture and false just after, to hide and restore distant geometry. */
  restrict: (capturing: boolean) => void;
};

type NodeBackgroundScene = THREE.Scene & { backgroundNode: unknown };

/**
 * A small player-centred reflection probe. The static HDR remains the source in
 * open directions, while actual visible scene geometry replaces it where the
 * hillside blocks that direction. Gameplay refreshes are amortized across
 * frames, but several faces are captured per rendered frame so a complete PMREM
 * advances at interactive cadence without a six-view spike on one frame.
 */
export class LocalReflectionProbe {
  readonly texture: THREE.CubeTexture;
  readonly facesPerFrame: number;
  private readonly scene: NodeBackgroundScene;
  private readonly excluded: THREE.Object3D;
  private readonly target: THREE.CubeRenderTarget;
  private readonly captureTarget: THREE.CubeRenderTarget;
  private readonly camera: THREE.CubeCamera;
  private readonly copyRegion = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(PROBE_SIZE, PROBE_SIZE, CUBE_FACES));
  private readonly copyOrigin = new THREE.Vector3();
  private readonly capturePosition = new THREE.Vector3();
  private readonly completedPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  private readonly environment: THREE.Texture;
  private readonly culling: ProbeCulling;
  private readonly detailVisible: boolean[];
  private face = -1;
  private targetInitialized = false;
  private dirty = true;

  constructor(
    scene: THREE.Scene, excluded: THREE.Object3D, environment: THREE.Texture, facesPerFrame = DEFAULT_FACES_PER_FRAME,
    culling: ProbeCulling = { detail: [], restrict: () => {} },
  ) {
    this.scene = scene as NodeBackgroundScene; this.excluded = excluded; this.environment = environment; this.culling = culling;
    this.detailVisible = new Array<boolean>(culling.detail.length).fill(true);
    this.facesPerFrame = facesPerFrame;
    this.target = new THREE.CubeRenderTarget(PROBE_SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
    this.captureTarget = new THREE.CubeRenderTarget(PROBE_SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
    this.texture = this.target.texture;
    this.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.captureTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.captureTarget.texture.generateMipmaps = false;
    this.captureTarget.texture.minFilter = THREE.LinearFilter;
    this.captureTarget.texture.magFilter = THREE.LinearFilter;
    this.camera = new THREE.CubeCamera(PROBE_NEAR, PROBE_FAR, this.captureTarget);
  }

  /** Force a fresh capture, e.g. after the render origin has been rebased. */
  invalidate() { this.dirty = true; }

  /** Use while the loading card is visible so the first gameplay frame is hot. */
  captureNow(renderer: THREE.WebGPURenderer, position: THREE.Vector3) {
    this.capturePosition.copy(position); this.camera.position.copy(position);
    this.withCapture(() => this.camera.update(renderer, this.scene));
    this.commitCapture(renderer);
    this.completedPosition.copy(position); this.face = -1; this.dirty = false;
  }

  /**
   * Capture several tiny faces each game frame; the displayed reflection still
   * changes only on complete cubes, so there are no mixed-position PMREM seams.
   */
  update(renderer: THREE.WebGPURenderer, position: THREE.Vector3) {
    let budget = this.facesPerFrame;
    while (budget-- > 0) {
      if (this.face < 0) {
        if (!this.dirty && this.completedPosition.distanceToSquared(position) < MOVE_THRESHOLD * MOVE_THRESHOLD) return;
        this.capturePosition.copy(position); this.camera.position.copy(position); this.camera.updateMatrixWorld(true);
        this.face = 0;
      }
      this.renderFace(renderer, this.face++);
      if (this.face === CUBE_FACES) {
        this.commitCapture(renderer);
        this.completedPosition.copy(this.capturePosition); this.face = -1; this.dirty = false;
      }
    }
  }

  private renderFace(renderer: THREE.WebGPURenderer, face: number) {
    if (this.camera.coordinateSystem !== renderer.coordinateSystem) {
      this.camera.coordinateSystem = renderer.coordinateSystem; this.camera.updateCoordinateSystem();
      this.camera.position.copy(this.capturePosition); this.camera.updateMatrixWorld(true);
    }
    const faceCamera = this.camera.children[face] as THREE.PerspectiveCamera;
    const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      this.withCapture(() => { renderer.setRenderTarget(this.captureTarget, face); renderer.render(this.scene, faceCamera); });
    } finally {
      renderer.setRenderTarget(previous); renderer.autoClear = autoClear;
    }
  }

  private commitCapture(renderer: THREE.WebGPURenderer) {
    if (!this.targetInitialized) { renderer.initRenderTarget(this.target); this.targetInitialized = true; }
    // Keep the material bound to one stable cube. A complete scratch cube is a
    // sub-megabyte GPU copy, so the next staged capture can begin immediately
    // without overwriting the coherent cube that PMREM will read this frame.
    renderer.copyTextureToTexture(this.captureTarget.texture, this.texture, this.copyRegion, this.copyOrigin);
    this.texture.needsPMREMUpdate = true;
  }

  private withCapture(render: () => void) {
    const visible = this.excluded.visible, background = this.scene.background, fog = this.scene.fog;
    const backgroundNode = this.scene.backgroundNode;
    const backgroundIntensity = this.scene.backgroundIntensity, backgroundBlurriness = this.scene.backgroundBlurriness;
    this.excluded.visible = false;
    const { detail } = this.culling;
    for (let i = 0; i < detail.length; i++) { this.detailVisible[i] = detail[i].visible; detail[i].visible = false; }
    this.culling.restrict(true);
    // The visible scene uses a procedural sky, but reflections need the
    // authored HDR beyond local geometry: its window is what makes the jelly
    // read as wet and glossy.
    this.scene.backgroundNode = null;
    this.scene.background = this.environment; this.scene.backgroundIntensity = 1; this.scene.backgroundBlurriness = 0; this.scene.fog = null;
    try { render(); }
    finally {
      this.culling.restrict(false);
      for (let i = 0; i < detail.length; i++) detail[i].visible = this.detailVisible[i];
      this.excluded.visible = visible; this.scene.background = background; this.scene.backgroundNode = backgroundNode;
      this.scene.backgroundIntensity = backgroundIntensity;
      this.scene.backgroundBlurriness = backgroundBlurriness; this.scene.fog = fog;
    }
  }

  dispose() { this.captureTarget.dispose(); this.target.dispose(); }
}
