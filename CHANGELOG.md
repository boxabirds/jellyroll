# Changelog

Versions follow [semantic versioning](https://semver.org): the minor number goes up for a release with new features, the patch number
for fixes only. The version lives in `package.json`; the deploy script puts it, with the commit it was built from, on the first
screen, in the browser console and in `/api/health`.

## 0.2.0

First version on the live site, https://jellyroll.away.software.

- A world high-scores table: a Cloudflare Worker and D1 referee the time, name entry on a 3D platform of giant jelly letters.
- A first screen with the title in jelly letters, credits (Jelly Baby by Scott Sun) and a link to the source.
- Biomes arrive a few at a time; power-ups are kept and used with the number keys or by tapping; marbles, bees and seeds.
- Freeze ray: freezes lakes (solid ice you can roll on), blackens lava, cools lava ground; scree fog events.
- Demo mode (`?demo=true`) with a set of scenes.
- A phone layout: power-ups and jump on the right edge, tilt and sound on the left; a keyboard that stays up for the name.
- A run is saved while it is played, on a worker thread, and offered back as "Continue your roll" after a crash or reload.
- The graphics being lost, or the browser having no WebGPU, show plain explanations instead of a stack of details.
