# Jellyland

An endless downhill for one small jelly. The hill never ends and never repeats,
and the jelly never stops.

![A jelly rolling down a grassy valley, a magnet pulling jelly mushrooms toward it](docs/screenshot.png)

Rolling wears the jelly away. Roll into the things that grow in patches down
the valley to merge with them: each one is pulled in with a plop, and the jelly
grows and takes on its colours, patterns and lumps. With nothing to eat a jelly
shrinks to nothing, and bigger jellies wear faster. The faint slime trail
behind it is the jelly it is losing. Top speed is 150 km/h; it takes a lot of W
and a good drop to get there.

The run passes through five biomes, 1.5 km each, blending into one another
over 200 m. Each has its own ground, light, terrain and thing to eat, and each
wears the jelly faster than the last:

| Biome | Wear | To eat | Character |
| --- | --- | --- | --- |
| Meadow | ×1 | jelly mushrooms | a mild clear day |
| Ice | ×1.25 | snowballs | bright, wide, slippery |
| Dunes | ×1.6 | cacti | big rolling swells under a gold sun |
| Scree | ×2.2 | crystals | narrow, rough, rocky, overcast |
| Lava | ×3.2 | embers | night, lit by glowing cracks |

![Ice, dunes, scree and lava](docs/biomes.png)

After the lava the sequence starts again with every wear rate half as high
again, and the jelly's minimum and default speeds 20% higher.

### Holes

From about 220 m the ground starts to have holes in it, a different kind in each
biome. They begin small and sparse, and every biome passed makes them bigger and
more joined up. None of them is instant death: each takes a little jelly at a
time, and none can slow the jelly below its minimum speed.

| Biome | Hole | What it does |
| --- | --- | --- |
| Meadow | pond | huge friction, melts the jelly fast |
| Ice | ice shards | each shard stabs and tears a piece off |
| Dunes | oasis | like a pond |
| Scree | steam vents | burn the jelly and throw it into the air, perhaps onto the next vent |
| Lava | lava | burns hard and slows the jelly a lot |

Three lanes down the valley are always kept clear, however narrow they get, so
there are always three ways through. Holes cover the banks up to the ridge, so
riding the wall is no way round. A jump clears a small hole.

Two power-ups float above the grass now and then:

- **Magnet** (red horseshoe): for ten seconds every collectible within nine
  metres is pulled in.
- **Seed packet**: sprays a pile of seeds in arcs down the valley ahead. They
  land and sprout at once into the collectible of the ground they landed on,
  ready to roll through.

Each merge plays out like two jellies melting together: the collectible presses
against the jelly and flattens, a smooth neck blends them as it sinks in, its
colour spreads through the jelly, and the jelly swells and wobbles. A small
"+N cm" shows how much the jelly grew.

**Scores:** distance covered, and air time (total seconds off the ground).

## Play

```sh
npm install
npm run dev
```

Open the printed URL in a WebGPU browser (Chrome, Edge, Safari 26+). There is no
WebGL fallback; an unsupported browser gets an error card, not a black canvas.
Sound starts on your first key press.

| Key | Does |
| --- | --- |
| `W` / `↑` | accelerate |
| `S` / `↓` | decelerate (never to a stop: the jelly cannot be stopped) |
| `A` / `←` | steer left |
| `D` / `→` | steer right |
| `Space` | jump (and roll again once worn away) |
| `R` | restart from the top |
| `M` | mute |
| `?` | show or hide the controls in the game |

### On a phone

Controls appear on touch screens: a translucent joystick on the left (up
accelerates, down decelerates, left and right steer), a large jump button on the
right (it also rolls again once worn away), and two small buttons for tilt
steering and sound. Tap the tilt button to steer by tilting the phone; the
position it is held in when you tap becomes "straight", and it works in portrait
and landscape. iOS asks for motion permission the first time. Sound starts on
your first touch, and the screen is kept awake while you play.

WebGPU needs a secure page, so a phone must load the game over HTTPS (a deployed
site or a tunnel); plain `http://<LAN address>` will report no WebGPU.

## Deploy

A production build is plain static files: HTML, JavaScript, images and two
small binaries. There is no server code.

```sh
npm install
npm run build      # writes the site to dist/
npm run preview    # optional: serve dist/ locally to check it
```

Upload the contents of `dist/` to any static host. Two things the host must do:

- serve over **HTTPS** (WebGPU and audio worklets need a secure context;
  `localhost` also counts);
- nothing else. No special headers are needed, and asset paths are relative,
  so the site works from a sub-folder as well as from the root.

Needs Node 20.19 or newer (Node 22 recommended) to build.

### Replit

The repository includes a `.replit` file:

- **Run** starts the dev server (`npm install && npm run dev`) on port 5173.
- **Deploy** as a **Static** deployment: build command
  `npm install && npm run build`, public directory `dist`.

If Replit asks for these in its deployment form instead of reading the file,
enter the same build command and public directory.

## How it is put together

- `src/game/` is the whole simulation and has no rendering imports: the terrain
  as a pure height function, the biome sequence, hashed rock, collectible and
  magnet placement, the holes (`hazards.ts`), the rolling-ball physics, wear and growth, and the jelly's
  wobble springs.
  `src/game/tuning.ts` holds every gameplay number.
- `src/world/` draws it: pooled terrain chunks refilled from the height
  function, instanced rocks and mushrooms, the shards, steam and bubbles of the holes, the deforming jelly (with the lobes
  of whatever it has absorbed), merge droplets, the slime trail, sky, chase
  camera, and a floating render origin so precision holds at any distance.
- `src/render/` is the renderer adapted from
  [Jelly Baby](https://github.com/scottstts/Jelly-Baby): WebGPU setup and
  failure policy, HDR environment, transmissive jelly material, local
  reflection probe, bloom and grade. It also holds the jelly colours and looks.
- `src/audio/` plays recorded CC0 sounds for merges (a random recipe per kind of
  collectible, with slight pitch variation) and landings; the jump, magnet, seed
  packet, lava ember and the sounds of the holes are synthesised with ZzFX; a drone runs on the JP-8 synth,
  a Rust/WASM engine in an AudioWorklet, whose filter opens with speed.
- `src/app/` is input, HUD and the frame loop.

## Checks

```sh
npm test    # simulation invariants (node --test)
uv run --with playwright scripts/drive.py http://localhost:5173/ shots "wait:2,shot:start,snap"
```

The second command drives the running dev server in real Chrome with real key
presses, writes screenshots, and prints the game state; see the docstring in
`scripts/drive.py`.

## Licence

GPL-3.0-only (see `LICENSE`). Jellyland is a derivative of Jelly Baby by Scott
Sun; `NOTICE.md` lists exactly which files are adapted and from where, including
the Apache-2.0 JP-8 engine.
