/**
 * Every setting of the water, in one place: how it looks (colour, clarity, reflection, waves, foam), how it ripples, and
 * how it splashes. The game reads these live, and the water designer (water-designer.html) edits the same object, so what
 * is tuned there is what the game draws. Shader settings are uniforms, so changing one takes effect at once; settings the
 * simulation and the spray read are plain numbers, read as they are used.
 *
 * Settings saved from the designer ("Use in game") are kept in the browser's local storage and override these defaults.
 */
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

export type WaterNumberSpec = { type: 'number'; key: string; label: string; min: number; max: number; step: number; value: number; hint?: string };
export type WaterColorSpec = { type: 'color'; key: string; label: string; value: string; hint?: string };
export type WaterSpec = WaterNumberSpec | WaterColorSpec;
export type WaterGroup = { name: string; blurb: string; specs: WaterSpec[]; /** Detailed settings, tucked away under "Advanced" in the designer. */ advanced?: boolean };

const n = (key: string, label: string, value: number, min: number, max: number, step: number, hint?: string): WaterNumberSpec => ({ type: 'number', key, label, value, min, max, step, hint });
const c = (key: string, label: string, value: string, hint?: string): WaterColorSpec => ({ type: 'color', key, label, value, hint });

export const WATER_GROUPS: WaterGroup[] = [
  {
    name: 'Quick settings',
    blurb: 'A few sliders that set the detailed ones below. Start here. Moving one of these resets the detailed settings it drives.',
    specs: [
      n('intensity', 'Processor intensity', 100, 0, 100, 1, 'How much work the water is allowed to do. Low: a coarse, cheap simulation, a plain surface and only a little spray. High: everything. The status line shows what it costs.'),
      n('drama', 'Splash drama', 100, 0, 200, 1, 'How big and spectacular splashes are: spray, crown, jet and the dent they leave.'),
      n('clearness', 'Clearness', 55, 0, 100, 1, 'Clear (see the bottom, strong bending) to murky (colour only, nothing seen through it).'),
      n('choppiness', 'Choppiness', 40, 0, 100, 1, 'Glassy calm to a rough, choppy surface.'),
      n('foaminess', 'Foaminess', 50, 0, 100, 1, 'How much white water: at the shore, on crests, and from splashes.'),
    ],
  },
  {
    name: 'Body',
    advanced: true,
    blurb: 'The water itself: what colour it is, how the light is eaten as it goes deeper, how much the view through it bends.',
    specs: [
      c('color', 'Water colour', '#2a97ad', 'The colour shallow water takes on, and the tint of what is scattered back from the depths.'),
      n('absorption', 'Absorption', 1.1, 0, 5, 0.01, 'How fast light is lost with depth (per metre). Higher: deeper water goes darker and more coloured sooner.'),
      n('scatter', 'Depth colour', 0.55, 0, 1.5, 0.01, 'How much of the water colour is added back with depth, so deep water is not black.'),
      n('clarity', 'Refraction', 0.09, 0, 0.4, 0.002, 'How much the surface bends the view of what is under it.'),
      n('shoreFade', 'Shore fade', 0.3, 0.02, 2, 0.01, 'How deep (metres) the water must be to be fully there. Shallower, it thins away: a soft shoreline.'),
      n('brightness', 'Brightness', 1, 0.2, 2.5, 0.01, 'Scales the lit water colour.'),
    ],
  },
  {
    name: 'Reflection',
    advanced: true,
    blurb: 'The sky and the sun in the surface.',
    specs: [
      n('reflection', 'Sky reflection', 1.4, 0, 4, 0.01, 'Strength of the sky reflected in the surface (it is stronger at a low angle, as real water is).'),
      n('roughness', 'Roughness', 0.03, 0.005, 0.4, 0.001, 'Low: a mirror-sharp sun glint. High: a soft, wide sheen.'),
      n('sunGlint', 'Sun glint', 1.2, 0, 4, 0.01, 'Strength of the sun’s highlight.'),
    ],
  },
  {
    name: 'Caustics',
    advanced: true,
    blurb: 'The bright net of light that wobbles across the bed under the water.',
    specs: [
      n('causticStrength', 'Strength', 0.7, 0, 3, 0.01),
      n('causticScale', 'Size', 0.9, 0.2, 4, 0.01, 'Cells per metre: higher is finer.'),
      n('causticSpeed', 'Speed', 0.35, 0, 2, 0.01),
    ],
  },
  {
    name: 'Waves',
    advanced: true,
    blurb: 'The small waves that are always moving over the surface, even when nothing has touched it.',
    specs: [
      n('waveHeight', 'Wave height', 0.09, 0, 0.5, 0.002, 'How steeply the waves tilt the surface.'),
      n('waveScale', 'Wave size', 0.75, 0.1, 4, 0.01, 'Waves per metre: higher is finer.'),
      n('waveSpeed', 'Wave speed', 0.3, 0, 2, 0.01),
      n('waveChop', 'Chop', 0.55, 0, 1.5, 0.01, 'How much fine, choppy detail is laid over the broad waves.'),
    ],
  },
  {
    name: 'Ripples',
    advanced: true,
    blurb: 'The rings that spread when the jelly goes in, and the wake as it wades. These are simulated, so they bounce off each other.',
    specs: [
      n('rippleStrength', 'Ripple strength', 1.6, 0, 6, 0.01, 'How strongly the ripples tilt the surface.'),
      n('rippleSpeed', 'Ripple speed', 3, 0.5, 8, 0.1, 'How fast rings travel across the water (m/s).'),
      n('rippleDamping', 'Ripple damping', 0.988, 0.95, 0.9995, 0.0005, 'Closer to 1: ripples travel further and last longer.'),
      n('rippleReach', 'Ripple reach', 10, 3, 24, 0.5, 'Metres from the jelly beyond which ripples are not drawn.'),
      n('rippleLift', 'Surface lift', 1, 0, 3, 0.01, 'How much the ripples raise and lower the surface itself (not only how it shines).'),
      n('dropRadius', 'Splash size', 1, 0.3, 3, 0.01, 'Width of the dent a splash makes, relative to the jelly.'),
      n('dropStrength', 'Splash depth', 1, 0, 3, 0.01, 'How deep that dent is.'),
      n('wakeStrength', 'Wake', 1, 0, 4, 0.01, 'How much a jelly wading through leaves behind.'),
    ],
  },
  {
    name: 'Foam',
    advanced: true,
    blurb: 'The white of broken water: at the shore, on wave crests, and where a splash has landed.',
    specs: [
      n('foamAmount', 'Splash foam', 1, 0, 3, 0.01, 'How much foam a splash leaves.'),
      n('foamLifetime', 'Foam lifetime', 2.2, 0.3, 8, 0.05, 'Seconds a patch of foam takes to fade.'),
      n('foamLace', 'Foam lace', 5, 1, 20, 0.1, 'Size of the holes and bubbles in the foam: higher is finer.'),
      n('foamBreakup', 'Foam breakup', 0.75, 0, 1, 0.01, 'How broken up the foam is: 0 a solid sheet, 1 lace.'),
      n('shoreFoam', 'Shore foam', 0.7, 0, 2, 0.01, 'Foam where the water meets the ground (found from how shallow it is).'),
      n('shoreFoamWidth', 'Shore foam width', 0.35, 0.05, 2, 0.01, 'Metres of depth over which it shows.'),
      n('crestFoam', 'Crest foam', 0.45, 0, 2, 0.01, 'Foam on the top of a high wave.'),
      n('foamBrightness', 'Foam brightness', 1, 0.3, 2, 0.01),
    ],
  },
  {
    name: 'Spray: droplets',
    advanced: true,
    blurb: 'The drops thrown up by a splash. They are real water: clear, bright at the edge, and they fall back and make ripples of their own.',
    specs: [
      n('sprayAmount', 'Amount', 1, 0, 3, 0.01, 'How many droplets, relative to the default.'),
      n('dropletSize', 'Size', 0.032, 0.01, 0.2, 0.002, 'Radius (metres) of a typical drop.'),
      n('dropletVariety', 'Size variety', 0.8, 0, 1.5, 0.01, 'How different the biggest and smallest are.'),
      n('launchSpeed', 'Launch speed', 6, 1, 20, 0.1, 'How fast the fastest drops leave (m/s) for a full-strength splash.'),
      n('spread', 'Spread', 1, 0.2, 2.5, 0.01, 'How far out the spray fans.'),
      n('gravity', 'Gravity', 1.3, 0.3, 3, 0.01, 'Multiple of Earth gravity.'),
      n('stretch', 'Streak', 0.075, 0, 0.2, 0.001, 'How long a drop is drawn along its path, per m/s: fast drops are streaks.'),
      n('dropletOpacity', 'Opacity', 0.5, 0.1, 1, 0.01),
      c('dropletTint', 'Tint', '#cfeeff'),
    ],
  },
  {
    name: 'Spray: crown and jet',
    advanced: true,
    blurb: 'The sheet of water that rises round the point of impact, and the column that follows it.',
    specs: [
      n('crownAmount', 'Crown', 1, 0, 2, 0.01, 'Size of the rising sheet (0 for none).'),
      n('crownHeight', 'Crown height', 1, 0.3, 3, 0.01),
      n('crownOpacity', 'Crown opacity', 0.42, 0.1, 1, 0.01),
      n('crownFingers', 'Crown fingers', 14, 4, 40, 1, 'Points round the rim of the crown.'),
      n('jetAmount', 'Jet', 1, 0, 2, 0.01, 'The column that rises in the middle after the crown (0 for none).'),
      n('jetHeight', 'Jet height', 1, 0.3, 3, 0.01),
      n('mist', 'Mist', 0.35, 0, 2, 0.01, 'The fine haze over a splash.'),
    ],
  },
];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * How each quick setting drives the detailed ones: a function of the slider (0..1) giving the detailed settings it sets.
 * Written against the built-in defaults, so moving a slider back to its default gives the defaults again.
 */
export const QUICK_DRIVES: Record<string, (k: number) => Record<string, number>> = {
  drama: k => { const f = k * 2; return { sprayAmount: f, crownAmount: f, jetAmount: f, dropStrength: f, foamAmount: f, mist: 0.35 * f, launchSpeed: lerp(2.5, 6, Math.min(1, f)) * (f > 1 ? 1 + (f - 1) * 0.5 : 1) }; },
  clearness: k => ({ absorption: lerp(3.6, 0.3, k), clarity: lerp(0.01, 0.16, k), scatter: lerp(1.2, 0.4, k), shoreFade: lerp(0.9, 0.12, k), causticStrength: lerp(0.1, 1.1, k) }),
  choppiness: k => ({ waveHeight: lerp(0.01, 0.26, k), waveChop: lerp(0.05, 1.2, k), rippleStrength: lerp(1, 2.6, k), waveSpeed: lerp(0.12, 0.7, k) }),
  foaminess: k => ({ foamAmount: lerp(0.15, 2.2, k), shoreFoam: lerp(0.05, 1.5, k), crestFoam: lerp(0, 1.4, k), foamLifetime: lerp(1.2, 4.5, k) }),
};

export const WATER_SPECS: WaterSpec[] = WATER_GROUPS.flatMap(group => group.specs);
const BY_KEY = new Map(WATER_SPECS.map(spec => [spec.key, spec]));
export const WATER_STORAGE_KEY = 'jellyland.water';

export class WaterSettings {
  /** Current values, read by the simulation and the spray as they are used. */
  readonly values: Record<string, number> = {};
  readonly colors: Record<string, string> = {};
  /** The same, as uniforms, read by the shaders. */
  readonly numberUniforms: Record<string, ReturnType<typeof uniform<number>>> = {};
  readonly colorUniforms: Record<string, ReturnType<typeof uniform<THREE.Color>>> = {};
  private readonly listeners = new Set<() => void>();

  constructor() {
    for (const spec of WATER_SPECS) this.write(spec, spec.value);
  }

  private write(spec: WaterSpec, value: number | string) {
    if (spec.type === 'number') {
      const number = Math.min(spec.max, Math.max(spec.min, Number(value)));
      this.values[spec.key] = number;
      (this.numberUniforms[spec.key] ??= uniform(number)).value = number;
    } else {
      const hex = String(value);
      this.colors[spec.key] = hex;
      const color = (this.colorUniforms[spec.key] ??= uniform(new THREE.Color()));
      color.value.set(hex);
    }
  }

  /** The number setting `key` as a uniform node. */
  num(key: string) {
    const node = this.numberUniforms[key];
    if (!node) throw new Error(`no water setting ${key}`);
    return node;
  }

  /** The colour setting `key` as a uniform node. */
  col(key: string) {
    const node = this.colorUniforms[key];
    if (!node) throw new Error(`no water colour ${key}`);
    return node;
  }

  set(key: string, value: number | string) {
    const spec = BY_KEY.get(key);
    if (!spec) return;
    this.write(spec, value);
    // A quick setting sets the detailed ones it drives.
    const drive = QUICK_DRIVES[key];
    if (drive && spec.type === 'number') {
      for (const [detail, v] of Object.entries(drive((this.values[key] - spec.min) / (spec.max - spec.min)))) {
        const target = BY_KEY.get(detail);
        if (target) this.write(target, v);
      }
    }
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset() {
    for (const spec of WATER_SPECS) this.write(spec, spec.value);
    for (const listener of this.listeners) listener();
  }

  toJSON(): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    for (const spec of WATER_SPECS) out[spec.key] = spec.type === 'number' ? this.values[spec.key] : this.colors[spec.key];
    return out;
  }

  load(data: Record<string, unknown>) {
    for (const spec of WATER_SPECS) {
      const value = data[spec.key];
      if (spec.type === 'number' && typeof value === 'number' && Number.isFinite(value)) this.write(spec, value);
      else if (spec.type === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) this.write(spec, value);
    }
    for (const listener of this.listeners) listener();
  }

  /** Keep these settings in the browser, so the game uses them. */
  save() {
    try { localStorage.setItem(WATER_STORAGE_KEY, JSON.stringify(this.toJSON())); } catch { /* private mode: not kept */ }
  }

  /** Go back to the built-in settings in the game. */
  forget() {
    try { localStorage.removeItem(WATER_STORAGE_KEY); } catch { /* nothing kept */ }
  }

  loadSaved() {
    try {
      const raw = localStorage.getItem(WATER_STORAGE_KEY);
      if (raw) this.load(JSON.parse(raw) as Record<string, unknown>);
    } catch { /* unreadable: keep the defaults */ }
  }
}

/** The one set of water settings the game, the simulation, the spray and the designer all share. */
export const waterSettings = new WaterSettings();
waterSettings.loadSaved();
