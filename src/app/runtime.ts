/**
 * Wires the simulation to the renderer and owns the frame loop. Subsystem
 * behaviour lives beside its data; this file only orders the work:
 * input → fixed physics steps → world streaming → pose → reflections → draw.
 */
import * as THREE from 'three/webgpu';
import { BIOMES, dominantBiome, wearScale } from '../game/biomes.ts';
import { ballSpeed, createBall, grantMagnet, resetBall, stepBall } from '../game/physics.ts';
import { MagnetItems } from '../world/magnet-items.ts';
import { START_COLOR } from '../render/colors.ts';
import { MushroomField, SLURP_SECONDS } from '../world/mushroom-field.ts';
import { MergeSplash } from '../world/merge-splash.ts';
import { SlimeTrail } from '../world/slime-trail.ts';
import { JellySound, type SoundState } from '../audio/sound.ts';
import { courseCenter, terrainHeight } from '../game/terrain.ts';
import { MAGNET_RADIUS, MAX_FRAME_SECONDS, MAX_SUBSTEPS_PER_FRAME, MIN_SPEED, PHYSICS_STEP } from '../game/tuning.ts';
import { createWobble, resetWobble, stepWobble } from '../game/wobble.ts';
import { createComposite } from '../render/composite.ts';
import { loadEnvironment } from '../render/environment.ts';
import { LocalReflectionProbe } from '../render/local-reflections.ts';
import { createRenderer, resizeView } from '../render/renderer.ts';
import { ChaseCamera } from '../world/chase-camera.ts';
import { createGroundLighting } from '../world/ground-lighting.ts';
import { JellyBall } from '../world/jelly-ball.ts';
import { RenderOrigin } from '../world/render-origin.ts';
import { RockField } from '../world/rock-field.ts';
import { atmosphereAt, createAtmosphere, loadGroundTextures } from '../world/biome-looks.ts';
import { Sky } from '../world/sky.ts';
import { TerrainMesh } from '../world/terrain-mesh.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';

/** Image-based light strength before the first biome's own setting is applied. */
const ENVIRONMENT_INTENSITY = 0.75;
/** Chunks refilled per frame while playing; the loading screen fills them all. */
const CHUNKS_PER_FRAME = 1;
const MILLISECONDS = 1000;
/** The magnet's ring on the ground fades out over its last moments, as a warning. */
const MAGNET_FADE_SECONDS = 1.5;

export type Game = { stop: () => void };

/** State exposed for automated checks; mirrors what the HUD shows plus raw pose. */
export type DebugSnapshot = {
  x: number; y: number; z: number; speed: number; distance: number; grounded: boolean;
  throttle: number; steer: number; jump: boolean; squash: number; frames: number;
  radius: number; merges: number; wornOut: boolean; mushroomsDrawn: number; airSeconds: number; magnetSeconds: number;
  biome: string; wear: number;
  sound: SoundState; audioContext: string; soundsPlayed: number; soundPeak: number; muted: boolean; helpShown: boolean;
};
declare global {
  interface Window {
    __jellyland?: {
      snapshot: () => DebugSnapshot;
      /** Test hook: drop the jelly at course distance `s`, `lateral` metres right of centre, `lift` metres up. */
      place: (s: number, lateral: number, lift: number) => void;
      /** Test hook: set the jelly's radius directly (e.g. to check the worn-out screen). */
      resize: (radius: number) => void;
      /** Test hook: switch the magnet on as if one had just been picked up. */
      magnet: () => void;
    };
  }
}

export async function startGame(stage: (message: string) => void, fail: (reason: unknown) => void): Promise<Game> {
  stage('Starting WebGPU');
  const renderer = await createRenderer(fail);
  document.querySelector('#viewport')!.append(renderer.domElement);

  stage('Loading light and grass');
  const scene = new THREE.Scene();
  const [environment, ground] = await Promise.all([loadEnvironment(renderer, scene, ENVIRONMENT_INTENSITY), loadGroundTextures()]);

  stage('Raising the hill');
  const sky = new Sky(scene, renderer, environment.toLight);
  const air = createAtmosphere();

  const ball = createBall();
  const wobble = createWobble();
  resetWobble(wobble, ball);
  const origin = new RenderOrigin();
  const lighting = createGroundLighting(environment.toLight, START_COLOR.deep);
  const terrain = new TerrainMesh(ground, lighting, environment.toLight);
  const rocks = new RockField();
  const jelly = new JellyBall();
  const mushrooms = new MushroomField();
  const splash = new MergeSplash();
  const trail = new SlimeTrail();
  const magnets = new MagnetItems();
  let playSeconds = 0;
  const sound = new JellySound();
  const rig = new ChaseCamera();
  // Everything transmissive lives in one group, hidden together while the
  // reflection probe captures: jellies do not appear in each other's reflections.
  const jellies = new THREE.Group();
  jellies.add(jelly.group, mushrooms.group);
  scene.add(terrain.group, rocks.mesh, trail.mesh, splash.mesh, magnets.group, jellies);
  const probe = new LocalReflectionProbe(scene, jellies, environment.reflectionTexture);
  jelly.setReflectionMap(probe.texture);
  const composite = createComposite(renderer, scene, rig.camera);
  const hud = new Hud();

  let accumulator = 0;
  let frames = 0;
  const restart = () => {
    hud.save();
    resetBall(ball);
    resetWobble(wobble, ball);
    jelly.reset();
    trail.reset();
    sound.reset();
    accumulator = 0;
    origin.follow(ball.z);
    rig.snap(ball, origin.z);
    probe.invalidate();
  };
  const input = new Input(restart, () => sound.toggleMute(), () => sound.start());

  /** Stream the world around the ball and pose everything in render space. */
  const present = (chunkBudget: number, dt: number) => {
    if (origin.follow(ball.z)) probe.invalidate();
    sky.apply(atmosphereAt(-ball.z, air));
    terrain.update(-ball.z, origin.z, chunkBudget);
    rocks.update(ball.x, ball.z, origin.z);
    mushrooms.update(ball.x, ball.z, origin.z, ball.ledger);
    mushrooms.animate(ball, origin.z, dt);
    splash.update(origin.z, dt);
    playSeconds += dt;
    trail.update(ball, jelly.shadowTint, origin.z, playSeconds);
    magnets.update(ball, origin.z, playSeconds);
    lighting.magnetReach.value = ball.radius + MAGNET_RADIUS;
    lighting.magnetStrength.value = Math.min(1, ball.magnetSeconds / MAGNET_FADE_SECONDS);
    jelly.update(ball, wobble, origin.z, dt);
    lighting.ballCenter.value.copy(jelly.center);
    lighting.ballRadius.value = ball.radius;
    lighting.jellyTint.value.copy(jelly.shadowTint);
  };

  let resizeQueued = 0;
  const resize = () => {
    if (resizeQueued) return;
    resizeQueued = requestAnimationFrame(() => { resizeQueued = 0; resizeView(renderer, rig.camera); });
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(document.documentElement);
  resizeView(renderer, rig.camera);

  stage('Warming up');
  present(Number.POSITIVE_INFINITY, 0);
  rig.snap(ball, origin.z);
  // Every biome's ground and every kind of collectible is compiled now, not on first sight.
  const restoreGround = terrain.warmMaterials(), restoreKinds = mushrooms.warmKinds();
  await renderer.compileAsync(scene, rig.camera);
  restoreGround(); restoreKinds();
  probe.captureNow(renderer, jelly.center);
  composite.render();
  // Compilation or submission errors must surface here, not as a black canvas later.
  await (renderer.backend as unknown as { device: GPUDevice }).device.queue.onSubmittedWorkDone();

  let last = performance.now();
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / MILLISECONDS));
    last = now;
    // A hidden tab neither simulates nor renders a stale frame.
    if (document.hidden) { accumulator = 0; return; }
    // Once the jelly has worn away, Space starts a new run (as R always does).
    if (ball.wornOut && input.jumpPressed) { restart(); input.jumpPressed = false; }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS_PER_FRAME) {
      // A tap can be pressed and released between two physics steps. The press
      // is latched by the input and fed to exactly one step, so it is never lost.
      const held = input.control.jump;
      if (input.jumpPressed) { input.control.jump = true; input.jumpPressed = false; }
      stepBall(ball, input.control, PHYSICS_STEP);
      input.control.jump = held;
      stepWobble(wobble, ball, PHYSICS_STEP);
      sound.step(ball);
      // Each merge: the mushroom is pulled in, droplets fly, the jelly swells where it landed, and it bloops.
      for (let i = 0; i < ball.pickupCount; i++) {
        const pickup = ball.pickups[i];
        mushrooms.slurp(pickup, ball);
        splash.spawn(pickup, ball);
        jelly.absorb(pickup, ball, SLURP_SECONDS);
      }
      accumulator -= PHYSICS_STEP;
      steps++;
    }
    // Catch-up is capped rather than allowed to spiral after a hitch.
    if (accumulator > PHYSICS_STEP) accumulator = 0;
    if (!Number.isFinite(ball.x + ball.y + ball.z)) throw new Error('The simulation produced a non-finite position');

    present(CHUNKS_PER_FRAME, dt);
    rig.update(ball, origin.z, dt);
    hud.update(ball, input.helpShown, dt);
    sound.frame(ball, dt);
    probe.update(renderer, jelly.center);
    composite.render();
    frames++;
  };
  const guardedFrame = (now: number) => {
    try { frame(now); } catch (error) { stop(); fail(error); }
  };

  const saveOnHide = () => { if (document.hidden) hud.save(); };
  document.addEventListener('visibilitychange', saveOnHide);
  window.__jellyland = {
    snapshot: () => ({
      x: ball.x, y: ball.y, z: ball.z, speed: ballSpeed(ball), distance: ball.distance, grounded: ball.grounded,
      throttle: input.control.throttle, steer: input.control.steer, jump: input.control.jump === true,
      squash: wobble.squash, frames,
      radius: ball.radius, merges: ball.merges, wornOut: ball.wornOut, mushroomsDrawn: mushrooms.drawn,
      airSeconds: ball.airSeconds, magnetSeconds: ball.magnetSeconds,
      biome: BIOMES[dominantBiome(-ball.z)].name, wear: wearScale(-ball.z),
      sound: sound.state, audioContext: sound.contextState, soundsPlayed: sound.played, soundPeak: sound.loudest, muted: sound.muted, helpShown: input.helpShown,
    }),
    place: (s, lateral, lift) => {
      ball.x = courseCenter(s) + lateral; ball.z = -s;
      ball.y = terrainHeight(ball.x, ball.z) + ball.radius + lift;
      ball.vx = 0; ball.vy = 0; ball.vz = -MIN_SPEED;
      resetWobble(wobble, ball);
      origin.follow(ball.z);
      rig.snap(ball, origin.z);
      trail.reset();
      probe.invalidate();
    },
    resize: radius => { ball.radius = radius; },
    magnet: () => grantMagnet(ball),
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    void renderer.setAnimationLoop(null);
    hud.save();
    input.dispose();
    sound.dispose();
    resizeObserver.disconnect();
    if (resizeQueued) cancelAnimationFrame(resizeQueued);
    document.removeEventListener('visibilitychange', saveOnHide);
    delete window.__jellyland;
  }

  function dispose() {
    stop();
    composite.dispose(); probe.dispose(); terrain.dispose(); rocks.dispose(); mushrooms.dispose(); splash.dispose(); trail.dispose(); magnets.dispose(); jelly.dispose();
    for (const maps of ground) for (const map of Object.values(maps)) map?.dispose();
    environment.dispose();
    renderer.domElement.remove();
    renderer.dispose();
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { once: true });
  import.meta.hot?.dispose(dispose);

  await renderer.setAnimationLoop(guardedFrame);
  return { stop };
}
