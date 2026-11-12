/*
 * Adapted from the owner's unixjelly project (GPL-3.0), src/engine/shell.html `JellyStage` and `jellyMaterial`. Changes: the
 * letters live in the game's own scene, in front of the camera, instead of a page of their own; they are typed one at a time
 * and drop in with a thump; the material is a node material for the game's renderer.
 */
import * as THREE from 'three/webgpu';
import { attribute, clamp, dot, float, mix, normalView, positionViewDirection, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { NAME_MAX_LETTERS } from '../../shared/run-rules.ts';
import { JellyBody, PHYS, STAND_UP_AFTER } from './jelly-body.ts';
import { advanceOf } from './letter-geometry.ts';

/** The guides' jelly colours: berry, lime, blue, lemon, orange, grape. */
export const JELLY_COLORS = ['#ff4d6d', '#62c934', '#3a5bff', '#ffc61a', '#ff8a2b', '#9b5cff'] as const;
/**
 * The physics size of a letter (metres to the em). The jelly's stiffness and weight are tuned for letters this small (the
 * Unix Jelly guides use 7 cm), so the physics runs at this size and the whole row is scaled up to fill the view.
 */
const LETTER_SIZE = 0.07;
/**
 * Gap between letters, as a share of the size. The guides' letters bump each other and walk home after a knock; here a name is
 * typed in one go with no tidying up, so the letters are spaced out enough that they do not touch and need no contacts.
 */
const GAP = 0.32;
/** How far in front of the camera the row stands (metres), and how much of the view it may fill. */
const DISTANCE = 7;
const FILL_WIDTH = 0.8;
const FILL_HEIGHT = 0.4;
/** Capital height as a share of the size, and where the row's middle sits in the view (share of its height, below the middle). */
const CAP_HEIGHT = 0.74;
const MIDDLE_BELOW = 0.04;
/** Letters appear this tall above the floor, as a share of the view's height, so they fall in from the top of the screen. */
const DROP_FROM_VIEW = 0.62;
/**
 * The input box is a platform the letters land on, left-aligned like a text field, wide enough for a name of NAME_MAX_LETTERS average
 * letters (and wider if the letters typed need it), with a flashing bar on it where the next letter goes.
 */
const PLATFORM_PAD = LETTER_SIZE * 0.5;
const PLATFORM_ROOM = LETTER_SIZE * 0.45;
const PLATFORM_THICKNESS = LETTER_SIZE * 0.22;
const PLATFORM_DEPTH = LETTER_SIZE * 1.8;
const PLATFORM_EDGE = LETTER_SIZE * 0.06;
const PLATFORM_COLOR = '#ffffff';
const PLATFORM_EDGE_COLOR = '#2b2140';
/** Brighter than white-hot yellow on purpose: the picture is graded and dimmed behind the name screen, and the bar must still glow. */
const CURSOR_COLOR = new THREE.Color(4, 3, 0.25);
const CURSOR_WIDTH = LETTER_SIZE * 0.12;
const CURSOR_HEIGHT = LETTER_SIZE * 0.82;
const CURSOR_DEPTH = LETTER_SIZE * 0.2;
/** The cursor shows for this long, then is hidden for as long again. */
const BLINK_SECONDS = 0.5;
const AVERAGE_ADVANCE = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].reduce((sum, c) => sum + advanceOf(c, LETTER_SIZE), 0) / 26;
const PLATFORM_MIN_WIDTH = NAME_MAX_LETTERS * AVERAGE_ADVANCE + (NAME_MAX_LETTERS - 1) * LETTER_SIZE * 0.32 + 2 * PLATFORM_PAD + PLATFORM_ROOM;
const MAX_STEPS = 7;
const MAX_FRAME = 1 / 20;
/** How fast the row slides to stay centred and the scale eases (per second). */
const EASE = 9;
/** A letter taken off flies up and is gone after this long. */
const LEAVE_SECONDS = 0.4;
const LEAVE_SPEED = 1.6;
/** A letter that has come to rest this far from its place (as a share of the size) is put back. */
const DISPLACED = 0.1;
/** A letter awake and out of place for this long is put down again. */
const STUCK_AFTER = 3;
/** A thud softer than this share is not worth a sound. */
const THUD_LEAST = 0.3;
/** How much deeper the colour is through the thickest jelly, and how much of the body's own light it gives off. */
const DEPTH_TINT = 0.55;
const GLOW = 0.5;
const BODY_LIGHTNESS = 0.5;
const DEEP_LIGHTNESS = 0.34;

interface Body { body: JellyBody; leavingFor: number }

/**
 * Glossy jelly, lit from inside where it is thin and deeper in colour where it is thick (`aThick`, per vertex). The guides' jelly is
 * see-through, but these letters are drawn on top of the game in a pass of their own, so there is nothing behind them to see
 * through: the colour is carried by the body instead, with the same gloss, rim light and window reflections.
 */
function letterMaterial(color: THREE.Color, size: number, env: Node<'vec3'> | null): THREE.MeshPhysicalNodeMaterial {
  const hsl = { h: 0, s: 0, l: 0 }; color.getHSL(hsl);
  // The grade at the end of the pipeline pales bright colours, so the body is a little deeper than the guides' pastels.
  const body = new THREE.Color().setHSL(hsl.h, 1, BODY_LIGHTNESS);
  const deep = new THREE.Color().setHSL(hsl.h, 1, DEEP_LIGHTNESS);
  const material = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.12, ior: 1.4, clearcoat: 1, clearcoatRoughness: 0.03 });
  const thick = attribute('aThick', 'float') as unknown as Node<'float'>;
  const depth = clamp(thick.div(size * 0.9), 0, 1);
  material.colorNode = mix(vec3(body.r, body.g, body.b), vec3(deep.r, deep.g, deep.b), depth.mul(DEPTH_TINT)) as unknown as Node<'color'>;
  const thin = clamp(float(1).sub(depth), 0.15, 1);
  const rim = float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)).pow(3).mul(0.5);
  material.emissiveNode = vec3(body.r, body.g, body.b).mul(thin.mul(0.4).add(rim)).mul(GLOW) as unknown as Node<'color'>;
  if (env) material.envNode = env;
  return material;
}

export class LetterStage {
  /**
   * The letters are drawn in a pass of their own (see composite.ts), on top of the finished game picture, so the hillside can never
   * cut into them: the stage stands in the air in front of the camera. Hidden until `show()`.
   */
  readonly scene = new THREE.Scene();
  readonly group = new THREE.Group();
  /** A letter landed (soft: a refusal wobble, or a letter that was put down without falling). */
  onLand: (soft: boolean) => void = () => {};
  private readonly row = new THREE.Group();
  private readonly bodies: Body[] = [];
  private readonly stage = { bounds: { x0: -LETTER_SIZE, x1: LETTER_SIZE * 10, z0: -LETTER_SIZE * 1.6, z1: LETTER_SIZE * 1.6 }, t: 0, onThud: (strength: number) => { if (strength >= THUD_LEAST) this.onLand(false); } };
  private readonly forward = new THREE.Vector3();
  private readonly flat = new THREE.Vector3(0, 0, -1);
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private accumulator = 0;
  private scale = 1;
  private platformWidth = PLATFORM_MIN_WIDTH;
  private readonly platform = new THREE.Group();
  private readonly platformTop: THREE.Mesh;
  private readonly platformEdge: THREE.Mesh;
  private readonly cursor: THREE.Mesh;
  private viewHeight = 1;
  private aspect = 1;
  private env: Node<'vec3'> | null = null;
  private shown = false;

  constructor() {
    this.group.visible = false;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.platformEdge = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: PLATFORM_EDGE_COLOR, roughness: 0.6 }));
    this.platformTop = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: PLATFORM_COLOR, roughness: 0.35, metalness: 0 }));
    this.platform.add(this.platformEdge, this.platformTop);
    this.cursor = new THREE.Mesh(new THREE.BoxGeometry(CURSOR_WIDTH, CURSOR_HEIGHT, CURSOR_DEPTH), new THREE.MeshBasicMaterial({ color: CURSOR_COLOR }));
    this.row.add(this.platform, this.cursor);
    this.group.add(this.row);
    this.scene.add(this.group, new THREE.HemisphereLight('#ffffff', '#b8c4d8', 1.2));
  }

  /** Light the letters with the game's own environment. */
  setEnvironment(texture: THREE.Texture | null, intensity: number) {
    this.scene.environment = texture; this.scene.environmentIntensity = intensity;
  }

  /** The reflection the letters shine with (the game's own probe), once it exists. */
  setReflection(env: Node<'vec3'>) { this.env = env; }

  get isShown(): boolean { return this.shown; }
  /** The letters of the word, in order (not the ones flying away). */
  get text(): string { return this.live().map(b => b.body.character).join(''); }
  get count(): number { return this.live().length; }
  /** Each letter's box (metres, in the row's own frame) and the row's scale: for checks. */
  get boxes() { return { scale: this.scale, letters: this.live().map(b => ({ character: b.body.character, lo: [...b.body.lo], hi: [...b.body.hi], home: b.body.homeX, displaced: b.body.displacement(), asleep: b.body.sleeping, rest: b.body.restTime })) }; }
  /** True when every letter is standing still. */
  get settled(): boolean { return this.bodies.every(b => b.body.sleeping || b.leavingFor > 0); }

  show(camera: THREE.PerspectiveCamera) {
    this.shown = true; this.group.visible = true; this.platformWidth = PLATFORM_MIN_WIDTH;
    this.viewHeight = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2); this.aspect = camera.aspect;
    this.scale = this.fitFor(this.platformWidth);
    this.place(camera, 1);
  }

  hide() {
    this.shown = false; this.group.visible = false;
    this.clear();
  }

  clear() {
    for (const item of this.bodies) this.discard(item);
    this.bodies.length = 0;
  }

  /** Add a letter at the end of the word. It falls from the top of the view and lands (or, with `animate` false, is simply there). */
  add(character: string, animate = true) {
    if (this.live().length >= NAME_MAX_LETTERS) return;
    const live = this.live();
    const last = live[live.length - 1]?.body;
    const advance = advanceOf(character, LETTER_SIZE);
    const cursor = last ? last.homeX + advanceOf(last.character, LETTER_SIZE) / 2 + LETTER_SIZE * GAP : 0;
    const index = live.length;
    const color = new THREE.Color(JELLY_COLORS[index % JELLY_COLORS.length]);
    const body = new JellyBody(this.stage, character, letterMaterial(color, LETTER_SIZE, this.env), cursor + advance / 2, LETTER_SIZE);
    this.row.add(body.mesh);
    const fit = this.fitFor(this.platformFor(body.homeX + advance / 2));
    if (animate && !this.reduced.matches) body.place(this.viewHeight / fit * DROP_FROM_VIEW + LETTER_SIZE * (Math.random() * 0.5), (Math.random() - 0.5) * 0.12);
    else { body.place(0.02, 0); this.onLand(true); }
    body.updateSurface();
    this.bodies.push({ body, leavingFor: 0 });
  }

  /** The last letter is tossed up and away. */
  removeLast() {
    const item = [...this.bodies].reverse().find(b => b.leavingFor === 0);
    if (!item) return;
    item.leavingFor = LEAVE_SECONDS;
    item.body.wake();
    for (let i = 0; i < item.body.N; i++) item.body.v[i * 3 + 1] += LEAVE_SPEED;
  }

  /** A refusal: the last letter (or all of them) hops, with a soft thump. */
  wobble(all = false) {
    const live = this.live();
    for (const item of all ? live : live.slice(-1)) item.body.hop(1.2);
    this.onLand(true);
  }

  private live(): Body[] { return this.bodies.filter(b => b.leavingFor === 0); }

  private discard(item: Body) {
    this.row.remove(item.body.mesh);
    (item.body.mesh.material as THREE.Material).dispose();
    item.body.dispose();
  }

  /** Step the physics, keep the row in front of the camera and centred, and draw the skins. */
  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.shown) return;
    this.place(camera, dt);
    this.stage.t += dt;
    this.accumulator += Math.min(dt, MAX_FRAME);
    let steps = 0;
    while (this.accumulator >= PHYS.step && steps < MAX_STEPS) {
      const h = PHYS.step;
      const moving = this.bodies.filter(b => b.body.begin(h));
      for (let pass = 0; pass < PHYS.iterations; pass++) for (const b of moving) b.body.iterate(h, pass);
      for (const b of moving) b.body.finish(h);
      this.accumulator -= h; steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const item = this.bodies[i];
      if (item.leavingFor > 0) { item.leavingFor -= dt; if (item.leavingFor <= 0) { this.discard(item); this.bodies.splice(i, 1); continue; } }
      const body = item.body;
      // A letter that has toppled, or been knocked out of its place, and has lain still is set back on its feet where it belongs.
      body.restTime = body.sleeping ? body.restTime + dt : 0;
      body.activeTime = body.sleeping ? 0 : body.activeTime + dt;
      // A letter that will not settle (wedged against a neighbour, rocking on a corner) is put down afresh after a while.
      const stuck = body.activeTime > STUCK_AFTER && body.displacement() > LETTER_SIZE * DISPLACED;
      if (stuck || (body.restTime > STAND_UP_AFTER && (body.isFallen() || body.displacement() > LETTER_SIZE * DISPLACED))) {
        body.cx = body.homeX; body.place(LETTER_SIZE * 0.2, 0);
      }
      if (body.dirty) body.updateSurface();
    }
  }

  /** How wide the platform is when the word reaches `wordEnd` along it: the minimum for a full name, or more if the letters need it. */
  private platformFor(wordEnd: number): number {
    return Math.max(PLATFORM_MIN_WIDTH, wordEnd + PLATFORM_ROOM + 2 * PLATFORM_PAD);
  }

  /** The scale that makes something `width` metres wide fill the view. */
  private fitFor(width: number): number {
    return Math.min(FILL_WIDTH * this.viewHeight * this.aspect / Math.max(width, 1e-3), FILL_HEIGHT * this.viewHeight / (CAP_HEIGHT * LETTER_SIZE));
  }

  /** Stand the row in front of the camera on level ground, as large as fits the view, and slide it to be centred. */
  private place(camera: THREE.PerspectiveCamera, dt: number) {
    camera.getWorldDirection(this.forward);
    this.flat.set(this.forward.x, 0, this.forward.z);
    if (this.flat.lengthSq() > 1e-6) this.flat.normalize();
    this.viewHeight = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.aspect = camera.aspect;
    const live = this.live();
    const last = live[live.length - 1]?.body;
    const wordEnd = last ? last.homeX + advanceOf(last.character, LETTER_SIZE) / 2 : 0;
    const ease = 1 - Math.exp(-EASE * dt);
    this.platformWidth += (this.platformFor(wordEnd) - this.platformWidth) * ease;
    this.scale += (this.fitFor(this.platformWidth) - this.scale) * ease;
    // The platform is centred; the word starts at its left end, inside the padding.
    this.row.position.set(PLATFORM_PAD - this.platformWidth / 2, 0, 0);
    this.platform.position.set(this.platformWidth / 2 - PLATFORM_PAD, -PLATFORM_THICKNESS / 2, 0);
    this.platformTop.scale.set(this.platformWidth, PLATFORM_THICKNESS, PLATFORM_DEPTH);
    // The dark rim stands a little proud on the sides and below, but under the light top so the top face shows.
    this.platformEdge.scale.set(this.platformWidth + PLATFORM_EDGE * 2, PLATFORM_THICKNESS, PLATFORM_DEPTH + PLATFORM_EDGE * 2);
    this.platformEdge.position.set(0, -PLATFORM_EDGE, 0);
    // The flashing bar stands where the next letter will go, on the platform; hidden once the name is full.
    const next = last ? last.homeX + advanceOf(last.character, LETTER_SIZE) / 2 + LETTER_SIZE * GAP * 0.5 : LETTER_SIZE * 0.05;
    this.cursor.position.set(next + CURSOR_WIDTH / 2, CURSOR_HEIGHT / 2, 0);
    this.cursor.visible = live.length < NAME_MAX_LETTERS && (this.reduced.matches || Math.floor(this.stage.t / BLINK_SECONDS) % 2 === 0);
    this.group.scale.setScalar(this.scale);
    this.group.rotation.y = Math.atan2(-this.flat.x, -this.flat.z);
    const baseline = camera.position.y + this.forward.y * DISTANCE - this.viewHeight * MIDDLE_BELOW - CAP_HEIGHT * LETTER_SIZE * this.scale / 2;
    this.group.position.set(camera.position.x + this.flat.x * DISTANCE, baseline, camera.position.z + this.flat.z * DISTANCE);
  }

  dispose() {
    this.clear();
    this.scene.clear();
  }
}
