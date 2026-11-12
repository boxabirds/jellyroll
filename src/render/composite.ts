/*
 * Adapted from Jelly Baby by Scott Sun (https://github.com/scottstts/Jelly-Baby),
 * src/graphics/scene/composite.ts. GPL-3.0-only; see LICENSE and NOTICE.md.
 * Changes: an optional second scene (the name-entry letters) is drawn over the finished picture, with a depth of its own, in a
 * second pipeline that is only built, and only run, while that scene is shown.
 */
import { RenderPipeline } from 'three/webgpu';
import type { WebGPURenderer, Scene, PerspectiveCamera } from 'three/webgpu';
import { pass, screenUV, float, vec3, vec4, mix, max } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** The overlay is where its colour is at least this bright in any channel (the clear colour is black). */
const OVERLAY_THRESHOLD = 1e-5;

/** Linear HDR scene → restrained lens glow → filmic contrast grade → one AgX/output transform. */
export function createComposite(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, overlay?: Scene, bloomResolutionScale = 0.5) {
  const build = (withOverlay: boolean) => {
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, 0.075, 0.18, 1.6);
    glow.setResolutionScale(bloomResolutionScale);
    const vignette = screenUV.sub(0.5).length().smoothstep(0.24, 0.73).mul(0.065);
    const balanced = color.rgb.add(glow.rgb).mul(vec3(0.985, 1.01, 1.015));
    // High-contrast filmic pre-grade around linear 18% gray. Keep highlights HDR for AgX.
    const contrasted = balanced.sub(0.18).mul(1.03).add(0.18).max(0);
    let graded = contrasted.mul(float(1).sub(vignette));
    let overlayPass: ReturnType<typeof pass> | null = null;
    if (withOverlay && overlay) {
      overlayPass = pass(overlay, camera);
      const letters = overlayPass.getTextureNode('output');
      const covered = max(max(letters.r, letters.g), letters.b).greaterThan(OVERLAY_THRESHOLD).select(float(1), float(0));
      graded = mix(graded, letters.rgb, covered);
    }
    const pipeline = new RenderPipeline(renderer, vec4(graded, color.a));
    return { pipeline, dispose: () => { glow.dispose(); scenePass.dispose(); overlayPass?.dispose(); pipeline.dispose(); } };
  };
  const base = build(false);
  let withOverlay: ReturnType<typeof build> | null = null;
  return {
    /** Draw a frame; with `showOverlay` the second scene goes over it. */
    render: (showOverlay = false) => {
      if (showOverlay && overlay) { withOverlay ??= build(true); withOverlay.pipeline.render(); } else base.pipeline.render();
    },
    dispose: () => { base.dispose(); withOverlay?.dispose(); },
  };
}
