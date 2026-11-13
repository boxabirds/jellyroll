/**
 * Wires the simulation to the renderer and owns the frame loop. Subsystem
 * behaviour lives beside its data; this file only orders the work:
 * input → fixed physics steps → world streaming → pose → reflections → draw.
 */
import * as THREE from 'three/webgpu';
import { BIOME_LENGTH, BIOME_ORDER, BIOMES, biomeStretch, dominantBiome, loopOfStretch, nextStretchOf, snowAt, wearScale } from '../game/biomes.ts';
import { hazardLevelBias, hazardShape, setHazardLevelBias } from '../game/hazards.ts';
import { addBee } from '../game/bees.ts';
import { shieldLevel } from '../game/progression.ts';
import { ballSpeed, createBall, grantGlass, grantMagnet, grow, resetBall, spraySeeds, stepBall, wantPowerup } from '../game/physics.ts';
import { MagnetItems } from '../world/magnet-items.ts';
import { SeedPacketItems } from '../world/seed-packet-items.ts';
import { FreezeItems } from '../world/freeze-items.ts';
import { FrostField } from '../world/frost-field.ts';
import { GlassItems } from '../world/glass-items.ts';
import { RockDebris } from '../world/rock-debris.ts';
import { SpikeField } from '../world/spike-field.ts';
import { CaveShell } from '../world/cave-shell.ts';
import { BeeItems } from '../world/bee-items.ts';
import { BeeFlock } from '../world/bee-flock.ts';
import { GLASS_EASE_SECONDS, POWERUP_FREEZE, POWERUP_GLASS } from '../game/tuning.ts';
import { SeedSpray } from '../world/seed-spray.ts';
import { START_COLOR } from '../render/colors.ts';
import { MushroomField } from '../world/mushroom-field.ts';
import { Merges } from '../game/merges.ts';
import { Alarm } from '../game/alarm.ts';
import { Stain } from '../game/stain.ts';
import { GrowthPopups } from './growth-popups.ts';
import { Badges } from './badges.ts';
import { DamageNumbers } from '../game/damage.ts';
import { BEE_MAX, SHIELD_REDUCTION } from '../game/tuning.ts';
import { beeCapacity } from '../game/progression.ts';
import { MergeSplash } from '../world/merge-splash.ts';
import { SNOW_PATH_LOOK, SlimeTrail } from '../world/slime-trail.ts';
import { HazardProps } from '../world/hazard-props.ts';
import { WaterInteraction } from '../world/water-interaction.ts';
import { WaterSurfaces } from '../world/water-surface.ts';
import { WaterSim } from '../water/sim.ts';
import { WaterSpray } from '../water/spray.ts';
import { currentQuality } from '../water/quality.ts';
import { waterSettings } from '../water/params.ts';
import { JellySound, type SoundState } from '../audio/sound.ts';
import { courseCenter, terrainHeight } from '../game/terrain.ts';
import { MAGNET_RADIUS, MAX_FRAME_SECONDS, MUSHROOM_TOUCH, MAX_SUBSTEPS_PER_FRAME, MIN_SPEED, PHYSICS_STEP } from '../game/tuning.ts';
import { createWobble, resetWobble, stepWobble } from '../game/wobble.ts';
import { createComposite } from '../render/composite.ts';
import { loadEnvironment } from '../render/environment.ts';
import { LocalReflectionProbe } from '../render/local-reflections.ts';
import { createRenderer, MAX_DEVICE_PIXEL_RATIO, MOBILE_MAX_DEVICE_PIXEL_RATIO, resizeView } from '../render/renderer.ts';
import { autoTune } from '../water/auto-tune.ts';
import { TiltSensor } from './tilt.ts';
import { TouchControls } from './touch-controls.ts';
import { ChaseCamera } from '../world/chase-camera.ts';
import { createGroundLighting } from '../world/ground-lighting.ts';
import { JellyBall } from '../world/jelly-ball.ts';
import { RenderOrigin } from '../world/render-origin.ts';
import { RockField } from '../world/rock-field.ts';
import { atmosphereAt, createAtmosphere, loadGroundTextures } from '../world/biome-looks.ts';
import { Sky } from '../world/sky.ts';
import { TerrainMesh } from '../world/terrain-mesh.ts';
import { Hud } from './hud.ts';
import { DebugGate } from './debug-gate.ts';
import { Splash } from './splash.ts';
import { RunSaver } from './run-saver.ts';
import { INTERRUPTED_EVENT } from '../render/unsupported.ts';
import { RESUME_MIN_METRES, SNAPSHOT_VERSION, assignDeep, canResume, type RunSnapshot } from './run-snapshot.ts';
import { frostPatches } from '../game/frost-store.ts';
import { Input, type DebugCommand } from './input.ts';
import { HighScores } from './high-scores.ts';
import { Demo } from './demo.ts';
import { LetterStage } from '../world/jelly-letters/letter-stage.ts';

/** Image-based light strength before the first biome's own setting is applied. */
const ENVIRONMENT_INTENSITY = 0.75;
/** Chunks refilled per frame while playing; the loading screen fills them all. */
const CHUNKS_PER_FRAME = 1;
const MILLISECONDS = 1000;
/** ?test=leaderboard-entry: how long after loading the jelly wears away, the distance it claims (metres), and the size it shrinks to. */
const TEST_DELAY_MS = 1200;
const TEST_DISTANCE = 40;
const TEST_RADIUS = 0.04;
/** Reflection faces captured per frame: fewer on phones. */
const MOBILE_PROBE_FACES = 1;
/** Short vibrations (milliseconds) on a merge and on a hard landing, where the phone can vibrate. */
const MERGE_BUZZ_MS = 12;
const HARD_LANDING_BUZZ_MS = 28;
const HARD_LANDING_SPEED = 9;

/** The reflection probe draws ground only this far (metres) in front of and behind the jelly. */
const PROBE_RANGE = 64;
/** The demo merge comes in a little above the jelly's equator, so it shows against the grass. */
const DEMO_RISE = 0.25;
/** The magnet's ring on the ground fades out over its last moments, as a warning. */
const MAGNET_FADE_SECONDS = 1.5;

export type Game = { stop: () => void };

/** State exposed for automated checks; mirrors what the HUD shows plus raw pose. */
export type DebugSnapshot = {
  x: number; y: number; z: number; speed: number; distance: number; grounded: boolean;
  throttle: number; steer: number; jump: boolean; squash: number; frames: number;
  radius: number; merges: number; wornOut: boolean; mushroomsDrawn: number; airSeconds: number; magnetSeconds: number; glassSeconds: number; trailTriangles: number; cost: Record<string, number>; water: unknown; spikesDown: number; spikesFallen: number; bees: number; beeDelivered: number; carried: number[]; shieldLevels: number[]; seedsAlive: number;
  biome: string; wear: number; holeDepth: number; holeKind: number; snow: number; rippleMs: number;
  sound: SoundState; audioContext: string; soundsPlayed: number; soundPeak: number; muted: boolean; helpShown: boolean;
};
declare global {
  interface Window {
    __jellyland?: {
      snapshot: () => DebugSnapshot;
      /** Test hook: drop the jelly at course distance `s`, `lateral` metres right of centre, `lift` metres up. */
      place: (s: number, lateral: number, lift: number) => void;
      /** Test hook: how many rock instances are drawn, and how many of those carry a near-white colour. */
      rockColors: () => { count: number; white: number; brightest: number };
      /** Test hook: set the jelly's radius directly (e.g. to check the worn-out screen). */
      resize: (radius: number) => void;
      /** Test hook: switch the magnet on as if one had just been picked up. */
      magnet: () => void;
      bench: (count: number) => Promise<unknown>;
      /** Test hooks: the glass marble now, a bee beside the jelly, and a count for one biome's shield (the level follows from the next pick-up). */
      glass: () => void;
      bee: () => void;
      shield: (kind: number, count: number) => void;
      /** Test hook: spray a packet's worth of seeds from the jelly. */
      seeds: () => void;
      /** Test hook: play one merge sound and report whether it was recorded or synthesised, and how loud. */
      letters: () => { text: string; count: number; settled: boolean; shown: boolean; boxes: { scale: number; letters: { character: string; lo: number[]; hi: number[] }[] } };
      probeMerge: (kind: number, radius: number) => Promise<{ source: string; peak: number }>;
      /** Test hook: the browser takes the graphics device away, as a phone can. */
      loseGpu: () => void;
      /** How many recorded sounds have loaded, of how many. */
      samples: () => { loaded: number; expected: number };
      /** Performance hook: show or hide one part of the scene (or skip the reflection probe) to find what costs frames. */
      toggle: (name: string, on: boolean) => void;
      /** Test hook: merge a mushroom of `kind` and `radius` into the jelly's right side, as if it had just touched it. */
      mergeDemo: (kind: number, radius: number, look: number) => void;
    };
  }
}

/** After a rotation the size is checked again at these delays (ms), for browsers that settle their layout late. */
const ROTATION_RECHECK_MS = [100, 350, 800];

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
  // The water: ripples (sim), what is thrown up (spray), the surfaces themselves, and what the jelly does to them. How much
  // work they do is set by the "processor intensity" setting (water/quality.ts), which is tuned for the device at load.
  let quality = currentQuality();
  const sim = new WaterSim(quality.simCells, quality.simHz, true);
  const waterSpray = new WaterSpray(sim, quality);
  const water = new WaterSurfaces(sim, quality);
  water.sun.value.copy(environment.toLight);
  const interaction = new WaterInteraction(sim, waterSpray);
  let appliedQuality = JSON.stringify(quality);
  const applyQuality = () => {
    const next = currentQuality();
    const text = JSON.stringify(next);
    if (text === appliedQuality) return;
    appliedQuality = text; quality = next;
    sim.configure(next.simCells, next.simHz);
    water.apply(next);
    waterSpray.apply(next);
  };
  waterSettings.onChange(applyQuality);
  const terrain = new TerrainMesh(ground, lighting, environment.toLight);
  const rocks = new RockField();
  const jelly = new JellyBall();
  const mushrooms = new MushroomField();
  const merges = new Merges();
  const splash = new MergeSplash();
  const trail = new SlimeTrail();
  const snowPath = new SlimeTrail(SNOW_PATH_LOOK);
  const SNOW_PATH_COLOR = new THREE.Color('#8fa6c4');
  /** The jelly leaves a path where the ground is at least this much snow. */
  const SNOW_PATH_FROM = 0.6;
  const magnets = new MagnetItems();
  const packets = new SeedPacketItems();
  const glassItems = new GlassItems();
  const freezeItems = new FreezeItems();
  const frost = new FrostField();
  const debris = new RockDebris();
  const spikes = new SpikeField();
  const cave = new CaveShell();
  const beeItems = new BeeItems();
  const letters = new LetterStage();
  const bees = new BeeFlock();
  /** 0 (jelly) to 1 (glass marble), eased so the change is seen and heard coming on and going off. */
  let glassLevel = 0;
  const WATER_NEEDS_CHUNKS_AHEAD = 2;
  /** A landed stalactite breaks into pieces as a rock this many times its radius would. */
  const SPIKE_DEBRIS_SIZE = 2.2;
  let seedsExplained = false;
  const stockSeen = [0, 0, 0, 0];
  // What each power-up does, said the way the player uses it: with a key on a keyboard, by tapping its icon on a touch screen.
  const POWERUP_HINTS = [
    ['Press 1 to switch on the magnet', 'Tap the magnet to switch it on'],
    ['Press 2 to become a glass marble', 'Tap the marble to become glass'],
    ['Press 3 to plant seeds', 'Tap the seeds to plant them'],
    ['Press 4 to freeze lakes and lava ahead', 'Tap the snowflake to freeze lakes and lava ahead'],
  ];
  const powerupHint = (slot: number) => POWERUP_HINTS[slot][document.documentElement.classList.contains('touch') ? 1 : 0];
  /** The key hint for each power-up is given only the first time one is found. */
  const hinted = [false, false, false, false];
  const projected = new THREE.Vector3();
  const spray = new SeedSpray();
  const holes = new HazardProps();
  let playSeconds = 0;
  const sound = new JellySound();
  const rig = new ChaseCamera();
  // Everything transmissive lives in one group, hidden together while the
  // reflection probe captures: jellies do not appear in each other's reflections.
  const jellies = new THREE.Group();
  jellies.add(jelly.group, mushrooms.group);
  scene.add(terrain.group, rocks.mesh, holes.group, water.mesh, waterSpray.group, snowPath.mesh, trail.mesh, splash.mesh, magnets.group, packets.group, glassItems.group, freezeItems.group, frost.group, beeItems.group, bees.group, spray.mesh, debris.mesh, spikes.group, cave.group, jellies);
  // The reflection is re-rendered from the scene several times a frame, so it only draws the ground around the
  // jelly and leaves out everything too small to see in it.
  const coarse = matchMedia('(pointer: coarse)').matches;
  const probe = new LocalReflectionProbe(scene, jellies, environment.reflectionTexture, coarse ? MOBILE_PROBE_FACES : undefined, {
    detail: [mushrooms.group, rocks.mesh, holes.group, water.mesh, waterSpray.group, trail.mesh, splash.mesh, magnets.group, packets.group, glassItems.group, freezeItems.group, frost.group, beeItems.group, bees.group, spray.mesh],
    restrict: capturing => terrain.limitTo(capturing, jelly.center.z, PROBE_RANGE),
  });
  jelly.setReflection(probe.node);
  letters.setReflection(probe.node);
  letters.setEnvironment(scene.environment, scene.environmentIntensity);
  const composite = createComposite(renderer, scene, rig.camera, letters.scene);
  const popups = new GrowthPopups(rig.camera);
  const stain = new Stain();
  const alarm = new Alarm();
  alarm.steady = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hud = new Hud();
  const badges = new Badges();
  const damage = new DamageNumbers();
  // The world table: the run is registered with the score server, and its score is signed with giant letters at the end.
  const demoMode = ['true', '1'].includes(new URLSearchParams(location.search).get('demo') ?? '');
  const scores = new HighScores(() => ball.distance, letters, rig.camera);
  const scoreNote = document.querySelector<HTMLElement>('#score-note')!;
  scores.onNote = text => { scoreNote.textContent = text; };
  /** True while name entry or the table is up: the game waits. */
  let modalOpen = false;
  let wasWornOut = false;

  let accumulator = 0;
  let frames = 0;
  let probeEnabled = true;
  const restart = () => {
    hud.save();
    resetBall(ball);
    stockSeen.fill(0);
    resetWobble(wobble, ball);
    jelly.reset();
    merges.reset();
    alarm.reset();
    stain.reset();
    hud.setAlarm(0, false);
    jelly.setAlarm(0);
    popups.clear();
    damage.reset();
    trail.reset();
    bees.reset();
    debris.reset();
    spikes.reset();
    glassLevel = 0;
    snowPath.reset();
    interaction.reset();
    sound.reset();
    accumulator = 0;
    origin.follow(ball.z);
    rig.snap(ball, origin.z);
    probe.invalidate();
    wasWornOut = false;
    saver.clear();
    gate.close();
    if (!demoMode) scores.runStarted();
  };
  const input = new Input(restart, () => sound.toggleMute(), () => sound.start());
  const gate = new DebugGate();
  const titleScreen = new Splash(letters, rig.camera);
  // A run in progress is saved every few seconds on a worker thread (the page only copies the snapshot into a message), so it can be
  // picked up again after the graphics, the page or the tab is lost.
  const saver = new RunSaver();
  const snapshot = (): RunSnapshot => ({
    version: SNAPSHOT_VERSION, savedAt: Date.now(), ball, frost: frostPatches, token: scores.session.runToken, debugUsed: scores.session.debugUsed,
  });
  const runInProgress = () => !demoMode && !ball.wornOut && !titleScreen.isOpen && ball.distance >= RESUME_MIN_METRES;
  const saveNow = () => { if (runInProgress()) saver.save(performance.now(), snapshot); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener(INTERRUPTED_EVENT, saveNow);
  const syncModal = (scoresOpen: boolean) => {
    modalOpen = scoresOpen || scores.open || gate.isOpen || titleScreen.isOpen; input.suspend(modalOpen);
    // The pointer is hidden while playing; the leaderboard, the name screen and the debug question have buttons, so it comes back for them.
    document.documentElement.classList.toggle('show-cursor', modalOpen);
  };
  scores.onModal = syncModal;
  gate.onOpen = () => syncModal(false);
  scores.entry.onThump = soft => sound.thump(soft);
  // The table is not part of play: it can be looked at once the jelly has worn away (and after signing a score).
  input.onTable = () => { if (ball.wornOut) scores.showTable(); };
  input.onUse = slot => { if (!modalOpen) wantPowerup(ball, slot); };
  for (const chip of document.querySelectorAll<HTMLElement>('#powerups .slot')) {
    chip.addEventListener('click', () => { chip.blur(); if (!modalOpen) wantPowerup(ball, Number(chip.dataset.slot)); });
  }
  document.querySelector<HTMLElement>('#scores-button')!.addEventListener('click', event => { (event.currentTarget as HTMLElement).blur(); if (ball.wornOut) scores.showTable(); });
  /** Where in a biome the debug jump drops the jelly: past the transition, and past the point where holes start. */
  const DEBUG_BIOME_OFFSET = 300;
  const DEBUG_BACK_METRES = 100;
  const MAX_DEBUG_HOLE_LEVEL = 60;
  /** Past this share of their final size, more levels change almost nothing. */
  const HOLES_MAXED_SHAPE = 0.98;
  const jumpTo = (s: number, lateral: number, lift: number) => {
    ball.x = courseCenter(s) + lateral; ball.z = -s;
    ball.y = terrainHeight(ball.x, ball.z) + ball.radius + lift;
    ball.vx = 0; ball.vy = 0; ball.vz = -MIN_SPEED;
    resetWobble(wobble, ball);
    origin.follow(ball.z);
    rig.snap(ball, origin.z);
    trail.reset();
    snowPath.reset();
    probe.invalidate();
  };
  /** The world was drawn from the old holes: rebuild all of it now, not a chunk a frame. */
  const redrawWorld = () => {
    terrain.invalidate(); rocks.invalidate(); spikes.invalidate(); cave.invalidate(); mushrooms.invalidate(); holes.invalidate(); water.invalidate();
    present(Number.POSITIVE_INFINITY, 0);
    probe.invalidate();
  };
  // The first debug key of a run asks first (it takes the run off the leaderboard); the rest of that run's are not asked about.
  input.onDebug = command => {
    if (scores.session.debugUsed) runDebug(command);
    else gate.ask(() => { scores.session.debugUsed = true; runDebug(command); });
  };
  const runDebug = (command: DebugCommand) => {
    if ('back' in command) {
      const s = Math.max(0, -ball.z - DEBUG_BACK_METRES);
      jumpTo(s, ball.x - courseCenter(-ball.z), 0);
      hud.toast(`Debug: back to ${Math.round(s)} m`);
      redrawWorld();
    } else if ('marble' in command) {
      ball.stock[POWERUP_GLASS]++;
      hud.toast('Debug: a glass marble to carry (press 2)');
    } else if ('freeze' in command) {
      ball.stock[POWERUP_FREEZE]++;
      hud.toast('Debug: a freeze ray to carry (press 4)');
    } else if ('bee' in command) {
      const added = addBee(ball.flock, ball.x + 1, ball.y + 1, ball.z);
      hud.toast(added ? `Debug: bee added (${ball.flock.count})` : `Debug: the flock is full (${BEE_MAX})`);
    } else if ('biome' in command) {
      // The nearest stretch of that biome from here on (the first time it is met, if it is not in this loop yet).
      const kind = BIOME_ORDER[command.biome];
      const stretch = nextStretchOf(kind, biomeStretch(-ball.z));
      jumpTo(stretch * BIOME_LENGTH + DEBUG_BIOME_OFFSET, 0, 0);
      hud.toast(`Debug: ${BIOMES[kind].name}, loop ${loopOfStretch(stretch) + 1}`);
      redrawWorld();
    } else {
      setHazardLevelBias(Math.min(MAX_DEBUG_HOLE_LEVEL, Math.max(-MAX_DEBUG_HOLE_LEVEL, hazardLevelBias() + command.holes)));
      const maxed = hazardShape(-ball.z) >= HOLES_MAXED_SHAPE;
      hud.toast(`Debug: holes level ${hazardLevelBias() >= 0 ? '+' : ''}${hazardLevelBias()}${maxed ? ' (holes are as big as they get here)' : ''}`);
      redrawWorld();
    }
  };
  // ?demo=true: the jelly plays itself through a loop of scenes (demo.ts); the keys are off and the run is not sent anywhere.
  let demo: Demo | null = null;
  const startDemo = () => {
    document.body.classList.add('demo');
    input.suspend(true);
    window.addEventListener('pointerdown', () => sound.start());
    demo = new Demo({
      ball, control: input.control,
      begin: (s, lateral) => { restart(); jumpTo(s, lateral, 0); redrawWorld(); },
    });
  };
  /** Carry on a saved run: the jelly, the freeze patches and the score server's token go back as they were, and the world is drawn there. */
  const resumeRun = (saved: RunSnapshot) => {
    assignDeep(ball as unknown as Record<string, unknown>, saved.ball as unknown as Record<string, unknown>);
    frostPatches.length = 0; frostPatches.push(...saved.frost);
    scores.session.resume(saved.token, saved.debugUsed);
    wasWornOut = false;
    // Nothing flies to the power-up chips for what was already carried.
    for (let slot = 0; slot < stockSeen.length; slot++) stockSeen[slot] = ball.stock[slot] ?? 0;
    resetWobble(wobble, ball); jelly.reset(); merges.reset(); alarm.reset(); stain.reset(); hud.setAlarm(0, false); jelly.setAlarm(0);
    popups.clear(); damage.reset(); trail.reset(); bees.reset(); debris.reset(); spikes.reset(); snowPath.reset(); interaction.reset();
    accumulator = 0;
    origin.follow(ball.z);
    rig.snap(ball, origin.z);
    redrawWorld();
    hud.toast('Back where you were');
  };
  // Touch: a stick, a jump button, and tilt steering from the phone's sensors.
  const tilt = new TiltSensor(text => hud.toast(text));
  const touch = new TouchControls(input, tilt, () => { sound.toggleMute(); return sound.muted; }, text => hud.toast(text));
  let wakeLock: WakeLockSentinel | null = null;
  const keepAwake = () => { if (navigator.wakeLock && !document.hidden) void navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {}); };
  touch.onFirstTouch = () => {
    // Browsers only allow sound and a wake lock after a touch, and iPhones count the touch ending, so both get a go.
    sound.start();
    window.addEventListener('pointerup', () => sound.start(), { once: true });
    keepAwake();
    hud.toast('Stick: speed and steering · button: jump · phone icon: tilt');
  };
  document.addEventListener('visibilitychange', keepAwake);
  if (coarse) touch.show();

  /** Stream the world around the ball and pose everything in render space. */
  const cost: Record<string, number> = {};
  const sums: Record<string, number> = {};
  const tally = (name: string, ms: number) => { cost[name] = Math.max(cost[name] ?? 0, ms); sums[name] = (sums[name] ?? 0) + ms; };
  const timed = (name: string, work: () => void) => { const t0 = performance.now(); work(); tally(name, performance.now() - t0); };
  const present = (chunkBudget: number, dt: number) => {
    if (origin.follow(ball.z)) probe.invalidate();
    timed('sky', () => { sky.apply(atmosphereAt(-ball.z, air)); });
    timed('terrain', () => { terrain.update(-ball.z, origin.z, chunkBudget); });
    timed('rocks', () => { rocks.update(ball.x, ball.z, origin.z, ball.brokenRocks); });
    timed('holes', () => { holes.update(ball.x, ball.z, origin.z, ball.clock); });
    // Water is held back only while the ground near the jelly is missing (after a jump somewhere new), not whenever the far
    // end of the view is being built, which is all the time.
    water.hold = !terrain.complete(-ball.z, WATER_NEEDS_CHUNKS_AHEAD);
    timed('water', () => { water.update(ball.x, ball.z, origin.z, chunkBudget === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : undefined); });
    timed('spray', () => { waterSpray.update(dt, origin.z); });
    timed('mushrooms', () => { mushrooms.update(ball.x, ball.z, origin.z, ball.ledger); });
    splash.update(origin.z, dt);
    playSeconds += dt;
    // A glass marble leaves no slime and no snow path: it is not shedding anything.
    trail.update(ball, jelly.shadowTint, origin.z, playSeconds, ball.glassSeconds <= 0);
    snowPath.update(ball, SNOW_PATH_COLOR, origin.z, playSeconds, snowAt(-ball.z) >= SNOW_PATH_FROM && ball.glassSeconds <= 0);
    magnets.update(ball, origin.z, playSeconds);
    packets.update(ball, origin.z, playSeconds);
    glassItems.update(ball.z, origin.z, ball.glassTakenSegment, false, playSeconds);
    freezeItems.update(ball.z, origin.z, ball.freezeTakenSegment, false, playSeconds);
    frost.update(dt, origin.z, ball);
    beeItems.frame(ball, origin.z, playSeconds);
    timed('bees', () => { bees.update(ball, origin.z, playSeconds, dt, rig.camera.position); });
    debris.update(origin.z, dt);
    timed('spikes', () => { spikes.update(ball, origin.z, dt); });
    timed('cave', () => { cave.update(ball.z, origin.z); });
    spray.update(ball.seeds, origin.z);
    lighting.magnetReach.value = ball.radius + MAGNET_RADIUS;
    lighting.magnetStrength.value = Math.min(1, ball.magnetSeconds / MAGNET_FADE_SECONDS);
    merges.update(dt);
    timed('merges+jelly', () => { jelly.update(ball, wobble, origin.z, dt, merges); });
    merges.clearCompleted();
    // The mushrooms in the middle of a merge are placed against the jelly as it is drawn this frame.
    timed('animate', () => { mushrooms.animate(merges, jelly.center, ball.seeds, origin.z, ball.flock); });
    lighting.ballCenter.value.copy(jelly.center);
    lighting.ballRadius.value = ball.radius;
    lighting.jellyTint.value.copy(jelly.shadowTint);
    lighting.jellyOpacity.value = ball.snow;
  };

  // How much of the screen's pixels are drawn (1 is the most the device is allowed); the benchmark below may lower it.
  let renderScale = 1;
  const drawResolution = () => (coarse ? MOBILE_MAX_DEVICE_PIXEL_RATIO : MAX_DEVICE_PIXEL_RATIO) * renderScale;
  let resizeQueued = 0;
  const resize = () => {
    if (resizeQueued) return;
    resizeQueued = requestAnimationFrame(() => { resizeQueued = 0; resizeView(renderer, rig.camera, drawResolution()); });
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(document.documentElement);
  resizeObserver.observe(renderer.domElement);
  // Turning a phone: browsers finish their layout late and sometimes report the old size first, so look again as it settles.
  const settle = () => { resize(); for (const delay of ROTATION_RECHECK_MS) setTimeout(resize, delay); };
  window.addEventListener('orientationchange', settle);
  window.visualViewport?.addEventListener('resize', resize);
  resizeView(renderer, rig.camera, drawResolution());

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
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  await device.queue.onSubmittedWorkDone();

  // Tune the water to this device: a short benchmark of the real scene, with a stretch of water and a splash in it, picks
  // the processor intensity and the render scale this device can hold 60 fps at. (?intensity=NN skips it and sets the intensity.)
  const forced = new URLSearchParams(location.search).get('intensity');
  if (forced !== null && Number.isFinite(Number(forced))) {
    waterSettings.set('intensity', Math.max(0, Math.min(100, Number(forced))));
  } else {
    stage('Measuring this device');
    water.benchmark(true, ball.x, ball.y - ball.radius, ball.z, origin.z);
    const centreX = ball.x, centreZ = ball.z, level = ball.y - ball.radius + 0.3;
    const result = await autoTune(
      async candidate => {
        waterSettings.set('intensity', candidate.intensity);
        renderScale = candidate.scale;
        resizeView(renderer, rig.camera, drawResolution());
        water.benchmark(true, ball.x, ball.y - ball.radius, ball.z, origin.z);
        await new Promise(resolve => setTimeout(resolve, 30));
      },
      async () => {
        const started = performance.now();
        present(0, 1 / 60);
        composite.render();
        await device.queue.onSubmittedWorkDone();
        return performance.now() - started;
      },
      () => interaction.splash(centreX, centreZ - 3, level, 0.9, 0, -4, 0.7, 1),
    );
    water.benchmark(false, 0, 0, 0, origin.z);
    interaction.reset();
    console.info(`[Jellyland] Water tuned for this device: intensity ${result.candidate.intensity}, render scale ${Math.round(result.candidate.scale * 100)}% (${result.medianMs.toFixed(1)} ms a frame; ${result.tried.map(t => `${t.candidate.intensity}/${Math.round(t.candidate.scale * 100)}%: ${t.medianMs.toFixed(1)} ms`).join(', ')})`);
  }

  let last = performance.now();
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / MILLISECONDS));
    last = now;
    // A hidden tab neither simulates nor renders a stale frame.
    if (document.hidden) { accumulator = 0; return; }
    // Once the jelly has worn away, Space starts a new run (as R always does).
    demo?.update(dt);
    if (modalOpen) input.jumpPressed = false;
    if (ball.wornOut && input.jumpPressed) { restart(); input.jumpPressed = false; }
    if (ball.wornOut && !wasWornOut) { scores.runEnded(ball.distance); saver.clear(); }
    wasWornOut = ball.wornOut;
    if (runInProgress() && !modalOpen) {
      saver.tick(now, snapshot);
      if (saver.lastCopyMs > 0) { tally('save', saver.lastCopyMs); saver.lastCopyMs = 0; }
    }
    accumulator += dt;
    // The game waits while the name or the table is on screen.
    if (modalOpen) accumulator = 0;
    let steps = 0;
    const tPhysics = performance.now();
    while (accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS_PER_FRAME) {
      // A tap can be pressed and released between two physics steps. The press
      // is latched by the input and fed to exactly one step, so it is never lost.
      const held = input.control.jump;
      if (input.jumpPressed) { input.control.jump = true; input.jumpPressed = false; }
      stepBall(ball, input.control, PHYSICS_STEP);
      input.control.jump = held;
      stepWobble(wobble, ball, PHYSICS_STEP);
      stain.step(ball, PHYSICS_STEP);
      sound.step(ball);
      if (navigator.vibrate && coarse) {
        if (ball.pickupCount > 0) navigator.vibrate(MERGE_BUZZ_MS);
        else if (ball.impact > HARD_LANDING_SPEED) navigator.vibrate(HARD_LANDING_BUZZ_MS);
      }
      // Said the first time only: after that the player knows.
      if (ball.seedsSprayed && !seedsExplained) { seedsExplained = true; hud.toast('Seeds sown ahead: they are sprouting down the hill'); }
      // Each merge: the mushroom is pulled in, droplets fly, the jelly swells where it landed, and it bloops.
      for (let i = 0; i < ball.pickupCount; i++) {
        const pickup = ball.pickups[i];
        jelly.absorb(pickup, ball, merges.start(pickup));
        splash.spawn(pickup, ball);
        popups.spawn(pickup, jelly.center, ball.radius, now);
      }
      for (let i = 0; i < ball.brokenCount; i++) {
        const rock = ball.broken[i];
        debris.burst(rock.x, rock.y, rock.z, rock.radius, rock.look, ball.vx, ball.vy, ball.vz);
      }
      // The cave: a stalagmite the marble hits is destroyed in a burst; a stalactite that comes down shatters where it lands.
      for (let i = 0; i < ball.toppledCount; i++) {
        const down = ball.toppled[i];
        // It is destroyed, not toppled: the pieces that burst from where it stood are all that is left of it.
        debris.burst(down.x, down.y + down.length * 0.35, down.z, down.radius * SPIKE_DEBRIS_SIZE, down.look, ball.vx, ball.vy, ball.vz);
      }
      for (let i = 0; i < ball.landedCount; i++) {
        const landed = ball.landed[i];
        debris.burst(landed.x, landed.y, landed.z, landed.radius * SPIKE_DEBRIS_SIZE, landed.look, 0, 0, 0);
      }
      // The freeze ray: a jet of foam pours out ahead; steam rises where it cooled lava or hot ground.
      if (ball.froze) {
        const speed = Math.hypot(ball.vx, ball.vz);
        frost.spray(speed > 1 ? ball.vx / speed : 0, speed > 1 ? ball.vz / speed : -1);
        for (const patch of ball.frostMade) {
          if (patch.kind !== 'ice') frost.steam(patch);
          // Frozen lakes are solid ground now: remake the terrain under them.
          if (patch.kind !== 'cool') { terrain.refresh(-patch.z - patch.radius, -patch.z + patch.radius); water.refresh(-patch.z - patch.radius, -patch.z + patch.radius); }
        }
      }
      if (ball.shieldUp >= 0) {
        const level = ball.shieldLevels[ball.shieldUp];
        hud.toast(`${BIOMES[ball.shieldUp].name} shield level ${level}: ${Math.round(SHIELD_REDUCTION[level - 1] * 100)}% less wear there`);
      }
      // A power-up found goes into its slot, to be used with its key.
      for (let slot = 0; slot < POWERUP_HINTS.length; slot++) {
        if (ball.stock[slot] > stockSeen[slot]) {
          // Its picture flies from the jelly to its chip; the first time ever, say which key uses it.
          projected.copy(jelly.center).project(rig.camera);
          hud.flyPowerup(slot, (projected.x + 1) / 2 * innerWidth, (1 - projected.y) / 2 * innerHeight);
          if (!hinted[slot]) { hinted[slot] = true; hud.toast(powerupHint(slot)); }
        }
        stockSeen[slot] = ball.stock[slot];
      }
      if (ball.beePicked) hud.toast(`A bee joins you (${ball.flock.count})`);
      if (ball.flock.levelledUp) hud.toast(`Your bees are stronger: they carry ${beeCapacity(ball.flock.delivered)} now`);
      accumulator -= PHYSICS_STEP;
      steps++;
    }
    tally('physics', performance.now() - tPhysics);
    cost.steps = Math.max(cost.steps ?? 0, steps);
    // Catch-up is capped rather than allowed to spiral after a hitch.
    if (accumulator > PHYSICS_STEP) accumulator = 0;
    if (!Number.isFinite(ball.x + ball.y + ball.z)) throw new Error('The simulation produced a non-finite position');

    const tPresent = performance.now();
    present(CHUNKS_PER_FRAME, dt);
    tally('present', performance.now() - tPresent);
    const lostCm = damage.step(ball.lost, dt);
    ball.lost = 0;
    if (lostCm > 0) popups.spawnLoss(lostCm, jelly.center, ball.radius, now);
    timed('badges', () => { badges.update(ball, now); });
    rig.update(ball, origin.z, dt);
    letters.update(dt, rig.camera);
    interaction.update(ball, dt);
    timed('sim', () => { sim.update(dt); });
    input.setTilt(tilt.steer());
    timed('hud', () => { hud.update(ball, input.helpShown, dt); });
    alarm.update(ball.radius, ball.wornOut, dt);
    jelly.setAlarm(alarm.level);
    jelly.setStain(stain.kind, stain.level);
    jelly.setSnow(ball.snow);
    const glassTarget = ball.glassSeconds > 0 ? 1 : 0, glassStep = dt / GLASS_EASE_SECONDS;
    glassLevel = glassTarget > glassLevel ? Math.min(glassTarget, glassLevel + glassStep) : Math.max(glassTarget, glassLevel - glassStep);
    jelly.setGlass(glassLevel);
    hud.setAlarm(alarm.level, alarm.severity > 0);
    timed('sound', () => { sound.frame(ball, dt); });
    const tRender = performance.now();
    if (probeEnabled) probe.update(renderer, jelly.center);
    tally('probe', performance.now() - tRender);
    if (plain) renderer.render(scene, rig.camera); else composite.render(letters.isShown);
    tally('render', performance.now() - tRender);
    frames++;
  };
  /** Draw straight to the screen, with no bloom or grade (for performance checks). */
  let plain = false;
  let benching = false;
  const guardedFrame = (now: number) => {
    if (benching) return;
    try { frame(now); } catch (error) { stop(); fail(error); }
  };
  /**
   * The performance budget's measurement: run `count` frames one after another, each a sixtieth of a second of game, and
   * time each from its start until the GPU has finished drawing it. That is what a frame really costs, whatever the
   * display's refresh rate is and however the browser paces frames. Also the most each part of the CPU work took.
   */
  const bench = async (count: number) => {
    benching = true;
    for (const key of Object.keys(cost)) { delete cost[key]; delete sums[key]; }
    const total: number[] = [], cpu: number[] = [];
    for (let i = 0; i < count; i++) {
      const started = performance.now();
      frame(last + MILLISECONDS / BENCH_HZ);
      cpu.push(performance.now() - started);
      await device.queue.onSubmittedWorkDone();
      total.push(performance.now() - started);
    }
    last = performance.now();
    benching = false;
    const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
    const at = (values: number[], q: number) => sorted(values)[Math.min(values.length - 1, Math.floor(q * values.length))];
    return {
      trace: total.map((ms, i) => [Math.round(ms * 10) / 10, Math.round(cpu[i] * 10) / 10]),
      frames: count, medianMs: at(total, 0.5), p95Ms: at(total, 0.95), worstMs: at(total, 1), cpuMedianMs: at(cpu, 0.5), cpuWorstMs: at(cpu, 1),
      parts: { ...cost }, means: Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum / count])), pixels: [renderer.domElement.width, renderer.domElement.height], s: -ball.z, biome: BIOMES[dominantBiome(-ball.z)].name,
    };
  };
  const BENCH_HZ = 60;

  const saveOnHide = () => { if (document.hidden) hud.save(); };
  document.addEventListener('visibilitychange', saveOnHide);
  window.__jellyland = {
    snapshot: () => ({
      x: ball.x, y: ball.y, z: ball.z, speed: ballSpeed(ball), distance: ball.distance, grounded: ball.grounded,
      throttle: input.control.throttle, steer: input.control.steer, jump: input.control.jump === true,
      squash: wobble.squash, frames,
      radius: ball.radius, merges: ball.merges, wornOut: ball.wornOut, mushroomsDrawn: mushrooms.drawn,
      airSeconds: ball.airSeconds, magnetSeconds: ball.magnetSeconds, glassSeconds: ball.glassSeconds, trailTriangles: bees.trailTriangles, bees: ball.flock.count, beeDelivered: ball.flock.delivered, carried: ball.flock.bees.slice(0, ball.flock.count).map(b => b.carried), shieldLevels: [...ball.shieldLevels], seedsAlive: ball.seeds.items.filter(i => i.alive).length,
      biome: BIOMES[dominantBiome(-ball.z)].name, wear: wearScale(-ball.z), holeDepth: ball.hazardDepth, holeKind: ball.hazardKind, snow: ball.snow, spikesDown: ball.toppledSpikes.total, spikesFallen: ball.fallenSpikes.total, water: water.stats(), cost: (() => { const copy = { ...cost }; for (const key of Object.keys(cost)) delete cost[key]; return copy; })(), rippleMs: sim.lastMilliseconds + waterSpray.lastMilliseconds,
      sound: sound.state, audioContext: sound.contextState, soundsPlayed: sound.played, soundPeak: sound.loudest, muted: sound.muted, helpShown: input.helpShown,
    }),
    place: (s, lateral, lift) => { scores.session.debugUsed = true; jumpTo(s, lateral, lift); },
    rockColors: () => {
      const colors = rocks.mesh.instanceColor?.array ?? new Float32Array(0);
      let white = 0, brightest = 0;
      for (let i = 0; i < rocks.mesh.count; i++) {
        const level = Math.min(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
        brightest = Math.max(brightest, level);
        if (level > 0.9) white++;
      }
      return { count: rocks.mesh.count, white, brightest };
    },
    resize: radius => { ball.radius = radius; },
    magnet: () => grantMagnet(ball),
    bench,
    glass: () => { scores.session.debugUsed = true; grantGlass(ball); },
    bee: () => { scores.session.debugUsed = true; addBee(ball.flock, ball.x + 1, ball.y + 1, ball.z); },
    shield: (kind, count) => { scores.session.debugUsed = true; ball.shieldCounts[kind] = count; ball.shieldLevels[kind] = shieldLevel(count); },
    toggle: (name, on) => {
      const parts: Record<string, THREE.Object3D> = {
        terrain: terrain.group, rocks: rocks.mesh, holes: holes.group, mushrooms: mushrooms.group, trail: trail.mesh, snowPath: snowPath.mesh, splash: splash.mesh,
        magnets: magnets.group, packets: packets.group, glass: glassItems.group, beeItems: beeItems.group, bees: bees.group, spray: spray.mesh, jelly: jelly.group,
      };
      if (name === 'probe') { probeEnabled = on; return; }
      if (name === 'bloom') { plain = !on; return; }
      if (name === 'ripples') { interaction.enabled = on; return; }
      if (name === 'water') { water.off = !on; return; }
      if (!parts[name]) throw new Error(`unknown part ${name}`);
      parts[name].visible = on;
    },
    letters: () => ({ text: letters.text, count: letters.count, settled: letters.settled, shown: letters.isShown, boxes: letters.boxes }),
    probeMerge: (kind, radius) => sound.probeMerge(kind, radius),
    loseGpu: () => (renderer.backend as unknown as { device: GPUDevice }).device.destroy(),
    samples: () => ({ loaded: sound.samplesLoaded, expected: sound.samplesExpected }),
    seeds: () => { spraySeeds(ball, 1); hud.toast('Seeds sown ahead: they are sprouting down the hill'); },
    mergeDemo: (kind, radius, look) => {
      const length = Math.hypot(1, DEMO_RISE);
      const pickup = ball.pickups[0];
      pickup.dx = 1 / length; pickup.dy = DEMO_RISE / length; pickup.dz = 0;
      pickup.distance = ball.radius + radius * MUSHROOM_TOUCH;
      pickup.radius = radius; pickup.kind = kind; pickup.look = look; pickup.color = 0; pickup.color2 = 3; pickup.seed = 0.37;
      const before = ball.radius;
      grow(ball, radius);
      pickup.jellyRadius = before; pickup.volume = ball.radius ** 3 - before ** 3;
      jelly.absorb(pickup, ball, merges.start(pickup));
      splash.spawn(pickup, ball);
      popups.spawn(pickup, jelly.center, ball.radius, performance.now());
    },
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    void renderer.setAnimationLoop(null);
    hud.save();
    input.dispose();
    scores.session.stop();
    saver.dispose();
    gate.dispose();
    titleScreen.dispose();
    scores.entry.dispose();
    scores.board.dispose();
    letters.dispose();
    tilt.disable();
    touch.dispose();
    wakeLock?.release().catch(() => {});
    document.removeEventListener('visibilitychange', keepAwake);
    sound.dispose();
    resizeObserver.disconnect();
    window.removeEventListener('orientationchange', settle);
    window.visualViewport?.removeEventListener('resize', resize);
    if (resizeQueued) cancelAnimationFrame(resizeQueued);
    document.removeEventListener('visibilitychange', saveOnHide);
    delete window.__jellyland;
  }

  function dispose() {
    stop();
    composite.dispose(); probe.dispose(); terrain.dispose(); rocks.dispose(); holes.dispose(); mushrooms.dispose(); splash.dispose(); popups.dispose(); badges.dispose(); trail.dispose(); snowPath.dispose(); sim.dispose(); water.dispose(); waterSpray.dispose(); magnets.dispose(); packets.dispose(); glassItems.dispose(); freezeItems.dispose(); frost.dispose(); debris.dispose(); spikes.dispose(); cave.dispose(); beeItems.dispose(); bees.dispose(); spray.dispose(); jelly.dispose();
    for (const maps of ground) for (const map of Object.values(maps)) map?.dispose();
    environment.dispose();
    renderer.domElement.remove();
    renderer.dispose();
  }
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { once: true });
  import.meta.hot?.dispose(dispose);

  if (demoMode) startDemo(); else scores.runStarted();
  // The first screen (not in the demo, the test pages, or with ?splash=0): the title, the credits and Play; the game waits behind it.
  const params = new URLSearchParams(location.search);
  if (!demoMode && !params.has('test') && params.get('splash') !== '0') {
    const shown = titleScreen.show();
    syncModal(false);
    // An interrupted roll (the graphics or the page were lost a moment ago) can be carried on: the button comes when it has been found.
    let saved: RunSnapshot | null = null;
    void saver.load().then(found => {
      if (!canResume(found, Date.now()) || !titleScreen.isOpen) return;
      saved = found;
      titleScreen.offerResume(`${Math.round(found.ball.distance)} m`);
    });
    void shown.then(choice => {
      syncModal(false); sound.start();
      if (choice === 'continue' && saved) resumeRun(saved); else saver.clear();
    });
  }
  // ?test=leaderboard-entry: skip the playing. A moment after loading the jelly wears away with a small real score, so the game over
  // and (if the local score server says it makes the top ten) the name screen come up at once. The server still checks the run.
  if (new URLSearchParams(location.search).get('test') === 'leaderboard-entry') {
    setTimeout(() => { ball.distance = TEST_DISTANCE; ball.radius = TEST_RADIUS; }, TEST_DELAY_MS);
  }
  await renderer.setAnimationLoop(guardedFrame);
  return { stop };
}
