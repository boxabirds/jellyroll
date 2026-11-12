/**
 * The water designer: a pool, a jelly to drop in it, and a slider for every setting of the water (see
 * world/water-params.ts). It is its own page (water-designer.html) and touches nothing in the game: try things here, then
 * say which settings to use. "Use in game" keeps them in this browser for when the game is wired to read them.
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createComposite } from '../render/composite.ts';
import { loadEnvironment } from '../render/environment.ts';
import { createRenderer, resizeView } from '../render/renderer.ts';
import { WATER_GROUPS, waterSettings } from '../water/params.ts';
import { bedHeight, createBed, POOL_RADIUS, WATER_LEVEL } from './bed.ts';
import { WaterSim } from '../water/sim.ts';
import { WaterSurface } from './surface.ts';
import { WaterSpray } from '../water/spray.ts';
import { PRESETS } from './presets.ts';
import { currentQuality, type Quality } from '../water/quality.ts';
import { autoTune } from '../water/auto-tune.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const JELLY_RADIUS = 0.6;
const GRAVITY = 9.81 * 1.3;
const SUBMERGED_DRAG = 2.2;
const ENV_INTENSITY = 1;
const MAX_FRAME = 0.05;

function fail(error: unknown) {
  const box = $('#fatal');
  box.style.display = 'grid';
  box.textContent = `The water designer could not start.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n\nIt needs a WebGPU browser (Chrome, Edge, Safari 26+).`;
  console.error(error);
}

async function main() {
  const renderer = await createRenderer(fail);
  $('#view').append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  camera.position.set(6.5, 3, 8.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -0.2, 0);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 2; controls.maxDistance = 45;
  controls.enableDamping = true;
  const environment = await loadEnvironment(renderer, scene, ENV_INTENSITY);
  scene.background = environment.reflectionTexture;
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.copy(environment.toLight).multiplyScalar(30);
  scene.add(sun);

  let quality: Quality = currentQuality();
  const sim = new WaterSim(quality.simCells, quality.simHz);
  const surface = new WaterSurface(sim, quality);
  surface.sun.value.copy(environment.toLight);
  const spray = new WaterSpray(sim, quality);
  // The quality follows the "processor intensity" slider.
  let appliedQuality = JSON.stringify(quality);
  const applyQuality = () => {
    const next = currentQuality();
    const text = JSON.stringify(next);
    if (text === appliedQuality) return;
    appliedQuality = text; quality = next;
    sim.configure(next.simCells, next.simHz);
    surface.apply(next);
    spray.apply(next);
  };
  waterSettings.onChange(applyQuality);
  const bedGroup = createBed();
  scene.add(bedGroup, surface.mesh, spray.group);

  // The jelly: a ball that can be dropped in, thrown in, or left sitting on the bottom.
  const jelly = new THREE.Mesh(
    new THREE.SphereGeometry(JELLY_RADIUS, 48, 48),
    new THREE.MeshPhysicalNodeMaterial({ color: '#86e040', transmission: 0.65, thickness: 1.1, ior: 1.35, roughness: 0.08, clearcoat: 0.4, attenuationColor: new THREE.Color('#3aa81c'), attenuationDistance: 1.2 }),
  );
  scene.add(jelly);
  const ball = { x: 0, y: 6, z: 0, vx: 0, vy: 0, vz: 0, inWater: false, resting: false, wake: 0 };
  const place = (x: number, y: number, z: number, vx: number, vy: number, vz: number) => {
    Object.assign(ball, { x, y, z, vx, vy, vz, inWater: y - JELLY_RADIUS < WATER_LEVEL && false, resting: false, wake: 0 });
  };
  const dropJelly = () => place((Math.random() - 0.5) * 1.5, 3 + Number(speedInput.value) * 0.5, (Math.random() - 0.5) * 1.5, 0, -Number(speedInput.value), 0);
  const throwJelly = () => place(-POOL_RADIUS - 2, 2.2, (Math.random() - 0.5) * 3, Number(speedInput.value) * 0.9 + 2, 3, 0);
  place(0, 40, 0, 0, 0, 0);
  const splash = (x: number, z: number, strength: number, vx: number, vz: number, radius: number) => {
    const values = waterSettings.values;
    sim.drop(x, z, radius * values.dropRadius * 1.3, -radius * values.dropStrength * (0.25 + 0.9 * strength));
    sim.addFoam(x, z, radius * 1.5 * values.dropRadius, Math.min(0.85, values.foamAmount * (0.35 + 0.5 * strength)));
    spray.splash(x, z, WATER_LEVEL, strength, vx, vz, radius);
  };
  let rain = false, rainClock = 0, paused = false;
  const rainDrop = () => {
    const angle = Math.random() * Math.PI * 2, reach = Math.sqrt(Math.random()) * POOL_RADIUS * 0.8;
    const x = Math.cos(angle) * reach, z = Math.sin(angle) * reach;
    sim.drop(x, z, 0.25, -0.025); sim.addFoam(x, z, 0.2, 0.25);
    spray.drip(x, z, WATER_LEVEL);
  };

  // Click on the water to drop something there.
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let downAt = [0, 0];
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const box = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL), new THREE.Vector3());
    if (hit) splash(hit.x, hit.z, Number(strengthInput.value) / 100, 0, 0, 0.5 + Number(strengthInput.value) / 100 * 0.6);
  });

  // --- Buttons and sliders ---
  const bar = $('#bar');
  const button = (label: string, action: (b: HTMLButtonElement) => void) => {
    const b = document.createElement('button'); b.textContent = label; b.onclick = () => action(b); bar.append(b); return b;
  };
  const speedInput = Object.assign(document.createElement('input'), { type: 'range', min: '2', max: '16', value: '8' });
  const strengthInput = Object.assign(document.createElement('input'), { type: 'range', min: '10', max: '100', value: '70' });
  button('Drop jelly', dropJelly);
  button('Throw jelly in', throwJelly);
  button('Splash (centre)', () => splash(0, 0, Number(strengthInput.value) / 100, 0, 0, 0.5 + Number(strengthInput.value) / 100 * 0.6));
  button('Rain', b => { rain = !rain; b.classList.toggle('on', rain); });
  button('Calm', () => { sim.reset(); spray.reset(); });
  button('Pause', b => { paused = !paused; b.classList.toggle('on', paused); });
  // Render scale: how many of the screen's pixels are drawn (the biggest cost on a high-resolution screen).
  const scaleInput = Object.assign(document.createElement('input'), { type: 'range', min: '25', max: '100', value: '70' });
  const sliders = document.createElement('span');
  sliders.style.cssText = 'display:flex;gap:10px;align-items:center;background:#0008;padding:4px 10px;border-radius:8px';
  for (const [label, input] of [['Impact speed', speedInput], ['Splash strength', strengthInput], ['Render scale', scaleInput]] as const) {
    const l = document.createElement('label'); l.textContent = label + ' '; l.append(input); sliders.append(l);
  }
  bar.append(sliders);

  const panel = $('#panel');
  panel.innerHTML = '<h1>Water designer</h1><p class="lead">Drop the jelly in, click the water, drag to look around. Every slider changes the water at once.</p>';
  const tools = document.createElement('div'); tools.className = 'tools';
  const presets = document.createElement('select');
  presets.innerHTML = '<option value="">Presets…</option>' + Object.keys(PRESETS).map(name => `<option>${name}</option>`).join('');
  presets.onchange = () => { if (presets.value) { waterSettings.reset(); waterSettings.load(PRESETS[presets.value]); syncAll(); } };
  const toolButton = (label: string, action: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = action; tools.append(b); };
  const json = Object.assign(document.createElement('textarea'), { spellcheck: false });
  toolButton('Defaults', () => { waterSettings.reset(); syncAll(); });
  toolButton('Copy settings', () => { json.value = JSON.stringify(waterSettings.toJSON(), null, 1); json.select(); void navigator.clipboard?.writeText(json.value); });
  toolButton('Load pasted', () => { try { waterSettings.load(JSON.parse(json.value)); syncAll(); } catch { json.value = 'That is not valid settings JSON.'; } });
  toolButton('Use in game', () => { waterSettings.save(); status('Saved in this browser as the settings the game will read.'); });
  toolButton('Forget saved', () => { waterSettings.forget(); status('Cleared the saved settings.'); });
  panel.append(presets, tools, json);
  const syncers: (() => void)[] = [];
  const syncAll = () => syncers.forEach(f => f());
  const advanced = document.createElement('details');
  advanced.innerHTML = '<summary>Advanced: every detailed setting</summary><div class="blurb">The quick settings above set these. Change one here to fine-tune; moving a quick setting resets the ones it drives.</div>';
  for (const group of WATER_GROUPS) {
    const details = document.createElement('details');
    details.open = !group.advanced;
    details.innerHTML = `<summary>${group.name}</summary><div class="blurb">${group.blurb}</div>`;
    for (const spec of group.specs) {
      const row = document.createElement('div'); row.className = 'row';
      const label = document.createElement('label'); label.textContent = spec.label;
      const out = document.createElement('output'); label.append(out);
      row.append(label);
      if (spec.type === 'number') {
        const input = Object.assign(document.createElement('input'), { type: 'range', min: String(spec.min), max: String(spec.max), step: String(spec.step) });
        input.oninput = () => { waterSettings.set(spec.key, Number(input.value)); out.textContent = String(waterSettings.values[spec.key]); };
        const sync = () => { input.value = String(waterSettings.values[spec.key]); out.textContent = String(waterSettings.values[spec.key]); };
        syncers.push(sync); sync(); row.append(input);
      } else {
        const input = Object.assign(document.createElement('input'), { type: 'color' });
        input.oninput = () => { waterSettings.set(spec.key, input.value); out.textContent = input.value; };
        const sync = () => { input.value = waterSettings.colors[spec.key]; out.textContent = waterSettings.colors[spec.key]; };
        syncers.push(sync); sync(); row.append(input);
      }
      if (spec.hint) { const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = spec.hint; row.append(hint); }
      details.append(row);
    }
    (group.advanced ? advanced : panel).append(details);
  }
  panel.append(advanced);
  const status = (text: string) => { $('#status').textContent = text; };

  const resize = () => {
    const box = $('#view').getBoundingClientRect();
    // The drawing buffer is the screen's pixels times this scale (at most 1 pixel per CSS pixel).
    renderer.setDrawingBufferSize(box.width, box.height, Math.min(window.devicePixelRatio, 1) * Number(scaleInput.value) / 100);
    camera.aspect = box.width / box.height; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('#view'));
  scaleInput.oninput = () => resize();
  void resizeView;
  resize();

  await renderer.compileAsync(scene, camera).catch(() => {});
  const composite = createComposite(renderer, scene, camera);
  let last = performance.now(), frames = 0, shown = performance.now(), cpu = 0, waterMs = 0, lastFrame = performance.now();
  const intervals: number[] = [];
  const toggles = { direct: false };
  const fpsBox = $('#fps');
  // Real frame rate: the time between the GPU finishing one frame and the next, not how often the page asks for one
  // (a page can ask 60 times a second while the GPU is still working through the last few). A new frame is not
  // started until the last is finished, so a slow GPU never builds up a queue.
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  let pending = false, completed = 0, benchmarking = false;
  const frame = (now: number) => {
    if (pending || benchmarking) { requestAnimationFrame(frame); return; }
    const dt = Math.min(MAX_FRAME, (now - last) / 1000); last = now;
    controls.update();
    if (!paused) {
      stepBall(dt);
      if (rain) { rainClock += dt; while (rainClock > 0.03) { rainClock -= 0.03; rainDrop(); } }
      sim.update(dt);
      spray.update(dt);
      waterMs = sim.lastMilliseconds + spray.lastMilliseconds;
    } else waterMs = 0;
    surface.mesh.position.y = 0;
    if (toggles.direct) renderer.render(scene, camera); else composite.render();
    frames++;
    pending = true;
    void device.queue.onSubmittedWorkDone().then(() => {
      pending = false; completed++;
      const done = performance.now();
      intervals.push(done - lastFrame); lastFrame = done;
      if (intervals.length > 30) intervals.shift();
    });
    cpu += (waterMs - cpu) * 0.05;
    if (frames % 10 === 0 && intervals.length > 1) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length, worst = Math.max(...intervals);
      fpsBox.firstChild!.textContent = `${Math.round(1000 / mean)} fps`;
      fpsBox.style.color = mean > 33 ? '#ff7a6a' : mean > 20 ? '#ffd36a' : '#8cf0a8';
      fpsBox.querySelector('small')!.textContent = `${mean.toFixed(1)} ms a frame (worst ${worst.toFixed(0)}) \u00b7 ${renderer.domElement.width}\u00d7${renderer.domElement.height} pixels`;
    }
    if (now - shown > 1000) { status(`${Math.round((frames * 1000) / (now - shown))} fps \u00b7 water ${quality.name} \u00b7 CPU ${cpu.toFixed(2)} ms a frame \u00b7 ripple grid ${sim.cells}\u00b2 \u00b7 ${spray.drawnDrops} droplets`); frames = 0; shown = now; }
    requestAnimationFrame(frame);
  };
  const stepBall = (dt: number) => {
    const wasIn = ball.inWater;
    ball.vy -= GRAVITY * dt;
    if (ball.inWater) { const k = Math.exp(-SUBMERGED_DRAG * dt); ball.vx *= k; ball.vy *= Math.exp(-SUBMERGED_DRAG * 1.6 * dt); ball.vz *= k; ball.vy += GRAVITY * 0.78 * dt; }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;
    const floor = bedHeight(ball.x, ball.z) + JELLY_RADIUS;
    if (ball.y < floor) { ball.y = floor; if (ball.vy < 0) ball.vy *= -0.15; ball.vx *= 0.97; ball.vz *= 0.97; }
    const submerged = ball.y - JELLY_RADIUS * 0.3 < WATER_LEVEL;
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (submerged && !wasIn && ball.vy < -1 || (submerged && !wasIn && Math.hypot(ball.vx, ball.vz) > 2)) {
      const strength = Math.min(1, speed / 14);
      splash(ball.x, ball.z, strength, ball.vx, ball.vz, JELLY_RADIUS * 1.1);
    }
    ball.inWater = submerged;
    if (submerged && Math.hypot(ball.vx, ball.vz) > 0.6) {
      ball.wake += dt;
      if (ball.wake > 0.05) {
        ball.wake = 0;
        const v = Math.hypot(ball.vx, ball.vz), values = waterSettings.values;
        sim.drop(ball.x, ball.z, JELLY_RADIUS * 0.9, -0.012 * v * values.wakeStrength);
        sim.addFoam(ball.x, ball.z, JELLY_RADIUS * 0.8, Math.min(0.6, 0.08 * v) * values.foamAmount);
      }
    }
    jelly.position.set(ball.x, ball.y, ball.z);
    jelly.rotation.x += ball.vz * dt / JELLY_RADIUS; jelly.rotation.z -= ball.vx * dt / JELLY_RADIUS;
  };
  // The device benchmark: pick the intensity and render scale this device can hold 60 fps at.
  const tuneNote = document.createElement('div');
  tuneNote.className = 'blurb';
  tuneNote.style.cssText = 'color:#8cf0a8;margin:4px 0 8px';
  panel.insertBefore(tuneNote, panel.children[2]);
  const benchFrame = async () => {
    const t0 = performance.now();
    controls.update();
    sim.update(1 / 60); spray.update(1 / 60);
    composite.render();
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  };
  const runTune = async () => {
    benchmarking = true;
    fpsBox.firstChild!.textContent = '…';
    fpsBox.querySelector('small')!.textContent = 'Measuring this device to choose the water settings';
    sim.reset(); spray.reset();
    const result = await autoTune(
      async candidate => {
        waterSettings.set('intensity', candidate.intensity);
        scaleInput.value = String(Math.round(candidate.scale * 100));
        resize(); syncAll();
        await new Promise(resolve => setTimeout(resolve, 30));
      },
      benchFrame,
      () => splash(0, 0, 0.9, 0, 0, 1),
    );
    sim.reset(); spray.reset();
    benchmarking = false; last = performance.now(); lastFrame = last; intervals.length = 0;
    const tried = result.tried.map(t => `${t.candidate.intensity}/${Math.round(t.candidate.scale * 100)}%: ${t.medianMs.toFixed(1)} ms`).join(', ');
    tuneNote.textContent = `Auto-tuned for this device in ${(result.totalMs / 1000).toFixed(1)} s: intensity ${result.candidate.intensity}, render scale ${Math.round(result.candidate.scale * 100)}% (${result.candidate.label}; ${result.medianMs.toFixed(1)} ms a frame). Tried ${tried}.`;
    return result;
  };
  const retune = document.createElement('button');
  retune.textContent = 'Re-run benchmark'; retune.onclick = () => { void runTune(); };
  tools.append(retune);
  syncAll();
  status('ready');
  await runTune();
  requestAnimationFrame(frame);
  (window as unknown as { __water: unknown }).__water = { runTune, toggles, bedGroup, surface, jelly, measure: (ms: number) => new Promise<number>(resolve => { const n0 = completed; const t0 = performance.now(); setTimeout(() => resolve(((completed - n0) * 1000) / (performance.now() - t0)), ms); }), splash, dropJelly, throwJelly, sim, spray, camera, controls, ball, settings: waterSettings };
}

main().catch(fail);
