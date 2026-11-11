# Notice

Jellyland is licensed under the GNU General Public License v3.0 only (see `LICENSE`).

It is a derivative work of **Jelly Baby** by Scott Sun,
https://github.com/scottstts/Jelly-Baby (GPL-3.0-only). The following files are
copied or adapted from that project; each carries a header saying what changed:

| Here | From Jelly Baby |
| --- | --- |
| `src/render/renderer.ts` | `src/graphics/scene/renderer.ts` |
| `src/render/composite.ts` | `src/graphics/scene/composite.ts` |
| `src/render/environment.ts` | `src/graphics/scene/environment.ts` |
| `src/render/studio-environment.generated.ts` | `src/graphics/scene/studio-environment.generated.ts` |
| `src/render/local-reflections.ts` | `src/graphics/scene/local-reflections.ts` |
| `src/render/jelly-material.ts` | `src/graphics/character/baby.ts`, `jelly-flavors.ts` |
| `src/assets/bg_room_studio.rgba16f` | `src/assets/bg_room_studio.rgba16f` |
| `src/assets/grass_texture/*` | `src/assets/grass_texture/*` |

The mushroom colours, looks and merge rule follow piece 2 of the owner's own
`xiuxiueig` project (GPL-3.0): `src/render/colors.ts` ports its `colors.js`,
and `src/render/jelly-looks.ts` re-expresses the `layered` and `findBit`
patterns of its `scene.frag` in TSL, evaluated on the skin instead of
raymarched. Merging conserves volume as there (`r = cbrt(r1³ + r2³)`).

Ground textures for the ice, dunes, scree and lava biomes are from ambientCG
(https://ambientcg.com), CC0 1.0; `src/assets/ground/README.md` lists the
assets.

Sound:
- merge and landing sounds are recorded CC0 samples from Kenney (kenney.nl) and
  OpenGameArt, in `src/audio/samples/`; `src/audio/samples/CREDITS.md` lists every pack,
  its source and licence evidence;
- effects are synthesised with the sample generator of ZzFX v1.4.0 by Frank
  Force (https://github.com/KilledByAPixel/ZzFX, MIT), vendored at
  `src/audio/zzfx/zzfx-synth.js` with its licence alongside. The header of
  that file lists the two changes made to it;
- the background drone is the owner's JP-8 synth engine (Apache-2.0), vendored
  as its compiled WASM, unmodified, at `src/audio/jp8/jp8_wasm_bg.wasm` with
  its licence alongside, and hosted by `src/audio/jp8-worklet.js`.

Everything else (terrain, physics, wobble, rocks, camera, HUD) is new.

If you distribute Jellyland or a modified version, GPLv3 requires you to make
the corresponding source available under the same licence.
