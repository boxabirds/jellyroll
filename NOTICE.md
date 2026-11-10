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

Sound is played on the owner's JP-8 engine (Apache-2.0):
`src/audio/jp8/jp8_wasm_bg.wasm` is its compiled engine, unmodified, with its
licence alongside; `src/audio/jp8-worklet.js` is a new host for it.

Everything else (terrain, physics, wobble, rocks, camera, HUD) is new.

If you distribute Jellyland or a modified version, GPLv3 requires you to make
the corresponding source available under the same licence.
