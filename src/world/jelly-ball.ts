/**
 * The visible jelly. A sphere looks identical however it is rotated, so the
 * body mesh never spins: its vertices are reshaped each frame in world axes
 * from the wobble state (squash, lean, a flattened contact patch).
 *
 * What does turn with the roll is everything the jelly has absorbed. Each
 * merged mushroom becomes a "lobe" fixed in the jelly's own coordinates: a lump
 * where it went in that springs back and settles, and a region of the body
 * that carries the mushroom's colours and look. The newest few lobes stay
 * distinct; older ones fold into the jelly's base colour, so over a run it
 * becomes a mix of everything it has eaten.
 */
import * as THREE from 'three/webgpu';
import { attribute, float, mix, smoothstep, uniform, varying, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Ball, Pickup } from '../game/physics.ts';
import { START_RADIUS } from '../game/tuning.ts';
import type { Wobble } from '../game/wobble.ts';
import { START_SWEET, SWEETS } from '../render/colors.ts';
import { lookShading } from '../render/jelly-looks.ts';
import { createJellyMaterial } from '../render/jelly-material.ts';

const SPHERE_DETAIL = 20;
/** Depth of the flattened contact patch at rest, as a fraction of radius. */
const PATCH_DEPTH = 0.06;
/** Extra patch depth per unit of squash. */
const PATCH_PER_SQUASH = 0.25;
/** Height (fraction of radius) over which displaced jelly bulges out above the patch. */
const BULGE_HEIGHT = 0.45;
const BULGE_GAIN = 0.9;
/** Squash at which the volume-preserving widening is computed stays above this. */
const MIN_AXIAL_SCALE = 0.4;

// --- Lobes: what is left of each merged mushroom ---------------------------------
const LOBE_COUNT = 3;
/** A lobe colours the body where the angle to its centre is small: cos edges. */
const LOBE_EDGE_FROM = -0.25;
const LOBE_EDGE_TO = 0.7;
/** Seconds for a lobe's colours to fade to 1/e as they dissolve into the base. */
const LOBE_LIFETIME = 45;
/** Fraction of a lobe's colour the base takes on as that lobe fades or is replaced. */
const BASE_FOLD = 0.25;
/**
 * Averaging sweets in RGB drifts toward grey. After each fold the base is
 * pulled back to a proper sweet: the mixed hue, at full strength.
 */
const BASE_DEEP_SATURATION = 0.9;
const BASE_DEEP_LIGHTNESS = 0.42;
const BASE_TINT_SATURATION = 0.85;
const BASE_TINT_LIGHTNESS = 0.7;
/** The lump a mushroom makes going in: height per (mushroom radius / jelly radius), and its cap. */
const BUMP_GAIN = 0.9;
const BUMP_MAX = 0.6;
/**
 * The lump is not there at once: it is launched outward as the mushroom
 * arrives and overshoots. This turns the target height into a starting speed.
 */
const BUMP_LAUNCH = 1.35;
/** Each merge flashes its part of the jelly in the mushroom's colour, fading at this rate (1/s). */
const FLASH_GAIN = 0.9;
const FLASH_FADE_RATE = 5;
/** The jelly swells to its new size instead of jumping to it (rate, 1/s). */
const SWELL_RATE = 9;
/** Angular spread of a lump: larger is broader. */
const BUMP_WIDTH = 0.22;
/** A settled lobe leaves the jelly this lumpy (fraction of radius), so shapes mix too. */
const BUMP_RESIDUAL = 0.07;
const BUMP_FREQUENCY_HZ = 3.2;
const BUMP_DAMPING_RATIO = 0.3;
const TAU = Math.PI * 2;

const PIP_SEGMENTS = 12;
const PIP_ROUGHNESS = 0.35;
/** Position (fraction of radius), size (fraction of radius) and colour of each pip. */
const PIPS = [
  { at: [0.34, 0.22, 0.1], size: 0.085, color: '#ffffff' },
  { at: [-0.3, -0.18, 0.26], size: 0.07, color: '#ffe46b' },
  { at: [0.05, -0.36, -0.22], size: 0.095, color: '#ff8fb1' },
  { at: [-0.16, 0.34, -0.24], size: 0.065, color: '#ffffff' },
  { at: [0.26, -0.08, -0.36], size: 0.075, color: '#8fd3ff' },
  { at: [-0.38, 0.04, -0.1], size: 0.06, color: '#ff8fb1' },
  { at: [0.02, 0.1, 0.4], size: 0.07, color: '#ffe46b' },
] as const;

type Lobe = {
  /** Centre of the lobe in the jelly's own (rolling) coordinates. */
  direction: THREE.Vector3;
  /** The same direction in world axes this frame. */
  world: THREE.Vector3;
  deep: THREE.Color;
  tint: THREE.Color;
  weight: { value: number };
  flash: { value: number };
  /** Seconds until the mushroom being slurped arrives and the lump is launched. */
  arriving: number;
  launch: number;
  look: { value: number };
  seed: { value: number };
  deep2: THREE.Color;
  bump: number;
  bumpVelocity: number;
};

export class JellyBall {
  /** Everything that belongs to the jelly; hidden as one while the reflection probe captures. */
  readonly group = new THREE.Group();
  /** Centre of the deformed body in render space; what the ground shadow follows. */
  readonly center = new THREE.Vector3();
  /** Average colour of light passing through the jelly; tints its shadow. */
  readonly shadowTint = new THREE.Color();
  private readonly body: THREE.Mesh;
  private readonly pips = new THREE.Group();
  private readonly directions: Float32Array;
  private readonly positions: Float32Array;
  private readonly material: THREE.MeshPhysicalNodeMaterial;
  private readonly radius = uniform(START_RADIUS);
  private readonly baseDeep = new THREE.Color();
  private readonly baseTint = new THREE.Color();
  private readonly bodyFromWorld = new THREE.Matrix3();
  private readonly lobes: Lobe[] = [];
  private nextLobe = 0;
  private shownRadius = START_RADIUS;
  private readonly spin = new THREE.Quaternion();
  private readonly inverseSpin = new THREE.Quaternion();
  private readonly rotation = new THREE.Matrix4();
  private readonly hsl = { h: 0, s: 0, l: 0 };

  constructor() {
    const sphere = new THREE.IcosahedronGeometry(1, SPHERE_DETAIL);
    sphere.deleteAttribute('uv');
    sphere.deleteAttribute('normal');
    // Indexed and seamless, so recomputed normals are smooth all the way round.
    const geometry = mergeVertices(sphere);
    sphere.dispose();
    const position = geometry.attributes.position as THREE.BufferAttribute;
    position.setUsage(THREE.DynamicDrawUsage);
    this.positions = position.array as Float32Array;
    this.directions = Float32Array.from(this.positions);
    for (let i = 0; i < this.directions.length; i += 3) {
      const inverseLength = 1 / Math.hypot(this.directions[i], this.directions[i + 1], this.directions[i + 2]);
      this.directions[i] *= inverseLength; this.directions[i + 1] *= inverseLength; this.directions[i + 2] *= inverseLength;
    }
    geometry.setAttribute('restDirection', new THREE.BufferAttribute(this.directions, 3));
    geometry.computeVertexNormals();
    (geometry.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);

    this.material = this.createMaterial();
    this.body = new THREE.Mesh(geometry, this.material);
    this.body.renderOrder = 1;
    // Vertices are rewritten every frame; the mesh is always on screen.
    this.body.frustumCulled = false;

    const pipGeometry = new THREE.SphereGeometry(1, PIP_SEGMENTS, PIP_SEGMENTS);
    for (const pip of PIPS) {
      const mesh = new THREE.Mesh(pipGeometry, new THREE.MeshStandardNodeMaterial({ color: pip.color, roughness: PIP_ROUGHNESS }));
      mesh.position.set(pip.at[0], pip.at[1], pip.at[2]);
      mesh.scale.setScalar(pip.size);
      this.pips.add(mesh);
    }
    this.group.add(this.body, this.pips);
    this.reset();
  }

  /** A fresh, single-coloured jelly with nothing absorbed. */
  reset() {
    this.baseDeep.copy(SWEETS[START_SWEET].deep);
    this.baseTint.copy(SWEETS[START_SWEET].tint);
    for (const lobe of this.lobes) { lobe.weight.value = 0; lobe.flash.value = 0; lobe.bump = 0; lobe.bumpVelocity = 0; lobe.launch = 0; }
    this.nextLobe = 0;
    this.shownRadius = START_RADIUS;
  }

  setReflectionMap(texture: THREE.Texture) {
    if (this.material.envMap !== texture) { this.material.envMap = texture; this.material.needsUpdate = true; }
  }

  /**
   * Melt a just-merged mushroom into the jelly where it touched. `delay` is how
   * long the mushroom takes to be pulled in; the lump and flash wait for it.
   */
  absorb(pickup: Pickup, ball: Ball, delay: number) {
    const lobe = this.lobes[this.nextLobe];
    this.nextLobe = (this.nextLobe + 1) % LOBE_COUNT;
    // Whatever this slot still held dissolves into the base colour.
    this.fold(lobe, BASE_FOLD * lobe.weight.value);
    this.inverseSpin.set(ball.qx, ball.qy, ball.qz, ball.qw).invert();
    lobe.direction.set(pickup.dx, pickup.dy, pickup.dz).applyQuaternion(this.inverseSpin);
    lobe.deep.copy(SWEETS[pickup.color].deep);
    lobe.tint.copy(SWEETS[pickup.color].tint);
    lobe.deep2.copy(SWEETS[pickup.color2].deep);
    lobe.look.value = pickup.look;
    lobe.seed.value = pickup.seed;
    lobe.weight.value = 1;
    lobe.arriving = delay;
    lobe.launch = Math.min(BUMP_MAX, (pickup.radius / ball.radius) * BUMP_GAIN) * TAU * BUMP_FREQUENCY_HZ * BUMP_LAUNCH;
  }

  update(ball: Ball, wobble: Wobble, originZ: number, dt: number) {
    // Swell (or shrink) toward the true size; keep the shortfall on the ground side.
    this.shownRadius += (ball.radius - this.shownRadius) * Math.min(1, SWELL_RATE * dt);
    const R = this.shownRadius;
    const shortfall = ball.radius - R;
    this.radius.value = R;
    this.spin.set(ball.qx, ball.qy, ball.qz, ball.qw);
    this.inverseSpin.copy(this.spin).invert();
    this.bodyFromWorld.setFromMatrix4(this.rotation.makeRotationFromQuaternion(this.inverseSpin));
    this.settleLobes(dt);

    const { nx, ny, nz } = ball;
    const axial = Math.max(MIN_AXIAL_SCALE, 1 - wobble.squash);
    // Squashing along the normal widens the body so its volume is unchanged.
    const radial = 1 / Math.sqrt(axial);
    const patch = R * wobble.contact * Math.max(0, PATCH_DEPTH + PATCH_PER_SQUASH * Math.max(0, wobble.squash));
    // The body's lowest point is `axial·R` below its centre, and the patch
    // slices `patch` off that. Sink the centre so the patch sits on the ground.
    const sink = R * (1 - axial) + patch + shortfall;
    const floor = -R * axial + patch;
    const bulgeHeight = R * BULGE_HEIGHT;
    const leanX = wobble.leanX * R, leanZ = wobble.leanZ * R;
    const [a, b, c] = this.lobes;

    const { directions, positions } = this;
    for (let i = 0; i < directions.length; i += 3) {
      const ux = directions[i], uy = directions[i + 1], uz = directions[i + 2];
      // Lumps from merged mushrooms push the skin out around each lobe's centre.
      const lump = R * (1 +
        a.bump * Math.exp((ux * a.world.x + uy * a.world.y + uz * a.world.z - 1) / BUMP_WIDTH) +
        b.bump * Math.exp((ux * b.world.x + uy * b.world.y + uz * b.world.z - 1) / BUMP_WIDTH) +
        c.bump * Math.exp((ux * c.world.x + uy * c.world.y + uz * c.world.z - 1) / BUMP_WIDTH));
      const dx = ux * lump, dy = uy * lump, dz = uz * lump;
      // Split into the part along the ground normal and the part across it.
      const alongRest = dx * nx + dy * ny + dz * nz;
      let along = alongRest * axial;
      let acrossX = (dx - nx * alongRest) * radial;
      let acrossY = (dy - ny * alongRest) * radial;
      let acrossZ = (dz - nz * alongRest) * radial;
      // Jelly pressed out of the patch has to go somewhere: just above it, outward.
      const above = along - floor;
      if (patch > 0 && above < bulgeHeight) {
        const bulge = 1 + (BULGE_GAIN * patch / R) * (1 - Math.max(0, above) / bulgeHeight);
        acrossX *= bulge; acrossY *= bulge; acrossZ *= bulge;
        if (above < 0) along = floor;
      }
      // Lean: the top lags, the base stays planted.
      const lift = (alongRest / R + 1) / 2;
      positions[i] = acrossX + nx * along + leanX * lift;
      positions[i + 1] = acrossY + ny * along;
      positions[i + 2] = acrossZ + nz * along + leanZ * lift;
    }
    const geometry = this.body.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    this.center.set(ball.x - nx * sink, ball.y - ny * sink, ball.z - nz * sink - originZ);
    this.body.position.copy(this.center);
    this.pips.position.copy(this.center);
    this.pips.quaternion.copy(this.spin);
    this.pips.scale.setScalar(R);
  }

  dispose() {
    this.body.geometry.dispose();
    this.material.dispose();
    for (const pip of this.pips.children as THREE.Mesh[]) (pip.material as THREE.Material).dispose();
    (this.pips.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
  }

  /** Blend a share of a lobe's colours into the base. */
  private fold(lobe: Lobe, share: number) {
    if (share <= 0) return;
    this.baseDeep.lerp(lobe.deep, share);
    this.baseDeep.getHSL(this.hsl, THREE.SRGBColorSpace);
    this.baseDeep.setHSL(this.hsl.h, Math.max(this.hsl.s, BASE_DEEP_SATURATION), BASE_DEEP_LIGHTNESS, THREE.SRGBColorSpace);
    this.baseTint.setHSL(this.hsl.h, BASE_TINT_SATURATION, BASE_TINT_LIGHTNESS, THREE.SRGBColorSpace);
  }

  /** Spring each lump toward its settled size, fade lobes into the base, refresh derived state. */
  private settleLobes(dt: number) {
    const omega = TAU * BUMP_FREQUENCY_HZ;
    const fade = 1 - Math.exp(-dt / LOBE_LIFETIME);
    let r = this.baseDeep.r, g = this.baseDeep.g, b = this.baseDeep.b, total = 1;
    for (const lobe of this.lobes) {
      if (lobe.launch > 0 && (lobe.arriving -= dt) <= 0) {
        lobe.bumpVelocity += lobe.launch;
        lobe.launch = 0;
        lobe.flash.value = 1;
      }
      lobe.flash.value -= lobe.flash.value * Math.min(1, FLASH_FADE_RATE * dt);
      const rest = BUMP_RESIDUAL * lobe.weight.value;
      lobe.bumpVelocity += (-omega * omega * (lobe.bump - rest) - 2 * BUMP_DAMPING_RATIO * omega * lobe.bumpVelocity) * dt;
      lobe.bump += lobe.bumpVelocity * dt;
      this.fold(lobe, BASE_FOLD * lobe.weight.value * fade);
      lobe.weight.value -= lobe.weight.value * fade;
      lobe.world.copy(lobe.direction).applyQuaternion(this.spin);
      r += lobe.deep.r * lobe.weight.value; g += lobe.deep.g * lobe.weight.value; b += lobe.deep.b * lobe.weight.value;
      total += lobe.weight.value;
    }
    this.shadowTint.setRGB(r / total, g / total, b / total);
  }

  private createMaterial() {
    // Shade in the jelly's own coordinates so absorbed looks roll with it.
    const q = varying(uniform(this.bodyFromWorld).mul(attribute('restDirection', 'vec3')), 'vJellyBody') as unknown as Node<'vec3'>;
    let attenuation = uniform(this.baseDeep) as unknown as Node<'vec3'>;
    let bit = float(0) as unknown as Node<'float'>;
    let bitColor = vec3(0) as unknown as Node<'vec3'>;
    let glow = vec3(0) as unknown as Node<'vec3'>;
    for (let i = 0; i < LOBE_COUNT; i++) {
      const lobe: Lobe = {
        direction: new THREE.Vector3(0, 1, 0), world: new THREE.Vector3(0, 1, 0),
        deep: new THREE.Color(), tint: new THREE.Color(), deep2: new THREE.Color(),
        weight: uniform(0), flash: uniform(0), arriving: 0, launch: 0, look: uniform(0), seed: uniform(0), bump: 0, bumpVelocity: 0,
      };
      this.lobes.push(lobe);
      const shading = lookShading(
        q, lobe.look as unknown as Node<'float'>,
        uniform(lobe.deep) as unknown as Node<'vec3'>, uniform(lobe.deep2) as unknown as Node<'vec3'>,
        lobe.seed as unknown as Node<'float'>,
      );
      const reach = smoothstep(LOBE_EDGE_FROM, LOBE_EDGE_TO, q.normalize().dot(uniform(lobe.direction)))
        .mul(lobe.weight as unknown as Node<'float'>);
      attenuation = mix(attenuation, shading.attenuation, reach) as unknown as Node<'vec3'>;
      bit = mix(bit, shading.bit, reach) as unknown as Node<'float'>;
      bitColor = mix(bitColor, shading.bitColor, reach) as unknown as Node<'vec3'>;
      glow = mix(glow, shading.glow, reach)
        .add(shading.attenuation.mul(reach).mul(lobe.flash as unknown as Node<'float'>).mul(FLASH_GAIN)) as unknown as Node<'vec3'>;
    }
    return createJellyMaterial({
      radius: this.radius as unknown as Node<'float'>,
      tint: uniform(this.baseTint) as unknown as Node<'vec3'>,
      attenuation, bit, bitColor, glow,
    });
  }
}
