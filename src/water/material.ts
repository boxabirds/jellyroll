/**
 * The water's surface shader, shared by the game and the designer. It reads the scene as drawn so far (so it can show what
 * is under the water, bent by the surface's slope), takes the depth of the water from the gap between the surface and
 * whatever is behind it, and lays foam, the sky and the sun on top. The ripple simulation (sim.ts) tilts and lifts it.
 * Which of the steps it does at all is set by the quality (quality.ts): the cheap settings leave out the costly ones.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, exp, float, linearDepth, max, mix, mx_noise_float, normalize, positionLocal, positionWorld,
  pow, reflect, screenUV, smoothstep, texture, time, transformNormalToView, vec2, vec3, viewportDepthTexture, viewportSharedTexture,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { waterSettings } from './params.ts';
import type { Quality } from './quality.ts';
import { SIM_SIZE, type WaterSim } from './sim.ts';

const FOAM_COLOR = [0.96, 0.98, 1] as const;
/** Wave trains: direction (x, z, also setting the wavelength), speed, and weight. The directions are unrelated, so the pattern does not visibly repeat. */
const BROAD_WAVES = [[2.1, 0.9, 5.2, 0.34], [-0.8, 2.6, 6.1, 0.3], [1.3, -1.9, 4.3, 0.36], [-2.9, -0.6, 7.4, 0.2]] as const;
const CHOP_WAVES = [[6.3, 2.2, 11, 0.12], [-3.1, 7.4, 13, 0.1], [4.9, -5.8, 9.5, 0.11]] as const;
/** Foam laps at the shore: how fast, and how much it breathes in and out. */
const LAP_RATE = 0.9;
const LAP_DEPTH = 0.35;
/** Wave heights (metres) at which a crest starts to be white, and is fully white. */
/** Shore foam is found from the real depth, counted this many times over (so it shows on the game's shallow shores). */
const SHORE_FOAM_DEPTH_SCALE = 7;
const CREST_FROM = 0.06;
const CREST_TO = 0.22;

export type WaterMaterialOptions = {
  quality: Quality;
  sim: WaterSim;
  /** Where the middle of the simulation is in the texture's coordinates: 0.5 for a pool centred on the origin, 0 for the world. */
  uvOffset: number;
  /** Read the per-vertex `wAlpha` (0 = no water here) and `wTint` (a colour factor) attributes. */
  perVertex: boolean;
  /**
   * The game's pools are only half a metre deep, where real water is all but clear. Depth counts this many times over for
   * the water's colour and for how soon it is fully there, so a shallow pool still reads as water (1 in the designer's deep pool).
   */
  /** Read the water's depth from the per-vertex `wDepth` attribute (metres) instead of from the screen: far cheaper, with no bending of what is under it. */
  vertexDepth?: boolean;
  depthScale?: number;
  /** The most depth (after scaling) that counts for colour: beyond it the water gets no more opaque. */
  maxDepth?: number;
  /** The water's own colour, scattered back from its depths, is this many times stronger: over dark ground (grass, rock) a pool would otherwise read as a dark hole, not as water (1 in the designer, whose bed is pale sand). */
  scatterGain?: number;
  /** The direction to the sun, and, if given, where the ripples are (a point in the world and how far they reach): they fade out beyond it. */
  sun: Node<'vec3'>;
  ripplesNear?: { centre: Node<'vec2'>; reach: Node<'float'> };
  /** Every texture node that reads the simulation is pushed here, so it can be pointed at a new texture when the grid is resized. */
  nodes: { value: unknown }[];
};

export function buildWaterMaterial(options: WaterMaterialOptions): THREE.MeshStandardNodeMaterial {
  const { quality, sim, uvOffset, perVertex, sun, ripplesNear, nodes } = options;
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const num = (key: string) => waterSettings.num(key) as unknown as Node<'float'>;
  const col = (key: string) => waterSettings.col(key) as unknown as Node<'vec3'>;
  const xz = positionWorld.xz;
  const simUV = (position: Node<'vec2'>) => position.div(SIM_SIZE).add(uvOffset);
  // Ripples are only drawn near whatever makes them (in the game, the jelly): the grid wraps, so they would repeat elsewhere.
  const near = ripplesNear ? float(1).sub(smoothstep(ripplesNear.reach.mul(0.7), ripplesNear.reach, xz.sub(ripplesNear.centre).length())) : float(1);
  const wetAlpha = perVertex ? (attribute('wAlpha', 'float') as unknown as Node<'float'>) : float(1);
  const tint = perVertex ? (attribute('wTint', 'vec3') as unknown as Node<'vec3'>) : vec3(1);

  // The surface rises and falls with the simulation (a vertex texture read, so it is left out of the cheap settings).
  if (quality.lift) {
    const liftNode = texture(sim.texture, simUV(positionLocal.xz as unknown as Node<'vec2'>)).level(0);
    nodes.push(liftNode as unknown as { value: unknown });
    const lifted = liftNode.b.mul(num('rippleLift')).mul(ripplesNear ? float(1).sub(smoothstep(ripplesNear.reach.mul(0.7), ripplesNear.reach, (positionLocal.xz as unknown as Node<'vec2'>).sub(ripplesNear.centre).length())) : float(1));
    material.positionNode = positionLocal.add(vec3(0, lifted, 0));
  }

  const field = texture(sim.texture, simUV(xz as unknown as Node<'vec2'>));
  nodes.push(field as unknown as { value: unknown });
  // Small waves that are always moving; a second, finer layer of them only at the higher settings.
  const waveScale = num('waveScale');
  const flow = time.mul(num('waveSpeed'));
  // (Sums of slanting ripples, not noise: this runs for every pixel of water, and noise here cost several milliseconds a frame.)
  const ripples = (trains: readonly (readonly [number, number, number, number])[], scale: Node<'float'>, rate: Node<'float'>) => {
    let sx: Node<'float'> = float(0), sz: Node<'float'> = float(0);
    for (const [dx, dz, speed, weight] of trains) {
      const wave = cos(xz.x.mul(scale.mul(dx)).add(xz.y.mul(scale.mul(dz))).add(rate.mul(speed))).mul(weight);
      sx = sx.add(wave.mul(dx)) as unknown as Node<'float'>; sz = sz.add(wave.mul(dz)) as unknown as Node<'float'>;
    }
    return vec2(sx, sz);
  };
  let waves = ripples(BROAD_WAVES, waveScale, flow);
  if (quality.fineDetail) waves = waves.add(ripples(CHOP_WAVES, waveScale, flow).mul(num('waveChop')));
  waves = waves.mul(num('waveHeight'));
  const ripple = vec2(field.r, field.g).mul(num('rippleStrength')).mul(near);
  const slope = waves.add(ripple);
  const normalWorldSpace = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const normalView = transformNormalToView(normalWorldSpace);
  material.normalNode = normalView;

  const water = col('color').mul(tint);
  const lost = vec3(1).sub(water).mul(num('absorption'));
  let thickness: Node<'float'>, realThickness: Node<'float'>, body: Node<'vec3'>, cover: Node<'float'>;
  if (options.vertexDepth) {
    // The game's way: each point of the surface knows how deep the water under it is, so nothing has to be read back from
    // the screen (copying the screen and its depth for the water cost 4 to 5 ms of every frame). The bed shows through by
    // ordinary blending: less of it the deeper the water, and not bent by the surface.
    realThickness = (attribute('wDepth', 'float') as unknown as Node<'float'>).max(0);
    thickness = realThickness.mul(options.depthScale ?? 1);
    if (options.maxDepth !== undefined) thickness = thickness.min(options.maxDepth) as unknown as Node<'float'>;
    const through = exp(lost.mul(thickness).negate());
    const depths = water.mul(num('scatter')).mul(options.scatterGain ?? 1).mul(float(1).sub(exp(thickness.mul(0.35).negate())));
    // Blending gives bed x (1 - cover) + colour x cover; that is bed x through + depths when cover is what the water stops.
    cover = float(1).sub(through.x.add(through.y).add(through.z).div(3)) as unknown as Node<'float'>;
    body = depths.div(cover.max(0.05)).mul(num('brightness')) as unknown as Node<'vec3'>;
  } else {
    // The designer's way: depth is the gap between this surface and the scene behind it, read from the screen.
    const here = linearDepth();
    const range = cameraFar.sub(cameraNear);
    const behindAt = (uv: Node<'vec2'>) => linearDepth(viewportDepthTexture(uv)).sub(here).mul(range);
    const straight = behindAt(screenUV as unknown as Node<'vec2'>).max(0);
    let lookUV: Node<'vec2'> = screenUV as unknown as Node<'vec2'>;
    thickness = straight as unknown as Node<'float'>;
    if (quality.bentRefraction) {
      // Bend the view by the slope, but only use it if what it lands on is behind the water (not the bank in front of it).
      const bend = vec2(normalView.x, normalView.y).mul(num('clarity')).mul(clamp(straight.mul(0.8), 0, 1));
      const bentUV = screenUV.add(bend) as unknown as Node<'vec2'>;
      const bentBehind = behindAt(bentUV);
      lookUV = bentBehind.greaterThan(0).select(bentUV, screenUV) as unknown as Node<'vec2'>;
      thickness = max(behindAt(lookUV), 0) as unknown as Node<'float'>;
    }
    const behind = viewportSharedTexture(lookUV).rgb;
    realThickness = thickness;
    thickness = thickness.mul(options.depthScale ?? 1) as unknown as Node<'float'>;
    if (options.maxDepth !== undefined) thickness = thickness.min(options.maxDepth) as unknown as Node<'float'>;
    const through = exp(lost.mul(thickness).negate());
    const depths = water.mul(num('scatter')).mul(options.scatterGain ?? 1).mul(float(1).sub(exp(thickness.mul(0.35).negate())));
    body = behind.mul(through).add(depths).mul(num('brightness')) as unknown as Node<'vec3'>;
    cover = smoothstep(0, num('shoreFade'), thickness) as unknown as Node<'float'>;
  }

  // Foam: left by splashes, along the shore, and on the crest of high waves, all broken up with noise.
  const lace = mx_noise_float(vec3(xz.mul(num('foamLace')), time.mul(0.25))).mul(0.5).add(0.5);
  const lace2 = quality.fineDetail ? mx_noise_float(vec3(xz.mul(num('foamLace').mul(2.3)).add(17), time.mul(-0.2))).mul(0.5).add(0.5) : lace;
  const holes = lace.mul(0.65).add(lace2.mul(0.35)).mul(num('foamBreakup'));
  const splashFoam = clamp(field.a.mul(near).mul(num('foamAmount')).mul(1.15).sub(holes.mul(1.3)).mul(4), 0, 1);
  const lap = time.mul(LAP_RATE).add(lace.mul(6)).sin().mul(LAP_DEPTH).add(1);
  const shoreFoam = clamp(float(1).sub(smoothstep(0, num('shoreFoamWidth').mul(lap), realThickness.mul(SHORE_FOAM_DEPTH_SCALE))).mul(num('shoreFoam')).mul(1.4).sub(holes.mul(0.8)).mul(3), 0, 1);
  const crestFoam = smoothstep(CREST_FROM, CREST_TO, field.b.abs().mul(near)).mul(num('crestFoam')).mul(clamp(lace.mul(1.6), 0, 1));
  const foam = clamp(splashFoam.add(shoreFoam).add(crestFoam), 0, 1);
  const foamColor = vec3(...FOAM_COLOR).mul(num('foamBrightness'));

  // The sun's glint, laid on by hand so its size and strength can be set apart from the sky's reflection.
  const toEye = normalize(vec3(0, 0, 0).sub(positionWorld).add(cameraPosition as unknown as Node<'vec3'>));
  const mirrored = reflect(toEye.negate(), normalWorldSpace);
  const shininess = float(2).div(pow(num('roughness'), 2).add(0.0004)).sub(2).min(6000);
  const glint = pow(max(dot(mirrored, normalize(sun)), 0), shininess).mul(num('sunGlint')).mul(float(1).sub(foam));

  material.colorNode = vec3(0);
  material.emissiveNode = mix(body, foamColor, foam).add(vec3(1, 0.97, 0.9).mul(glint)) as unknown as Node<'vec3'>;
  material.roughnessNode = mix(num('roughness'), float(0.7), foam);
  material.specularIntensityNode = num('reflection').mul(float(1).sub(foam)) as unknown as Node<'float'>;
  material.opacityNode = max(cover, foam.mul(0.95)).mul(wetAlpha) as unknown as Node<'float'>;
  return material;
}
