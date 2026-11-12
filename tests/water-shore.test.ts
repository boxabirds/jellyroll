import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHoleDisc, holeCellIndex, holeInCell, isLiquidKind, setHazardLevelBias } from '../src/game/hazards.ts';
import { discLevel } from '../src/game/terrain.ts';
import { createShoreVertex, shoreVertex } from '../src/game/water-shore.ts';

/** The water of a pool on any ground, hills included, is level and never hangs in the air. */
test('water is level and held in on hills: wet only below the surface, dry points under the ground, no edge over a drop', () => {
  setHazardLevelBias(6);
  try {
    const disc = createHoleDisc(), v = createShoreVertex(), w = createShoreVertex();
    let holes = 0, cliffs = 0;
    const LIMIT = 120;
    // Hills are in the later biomes: look along a long stretch so steep ground is well represented.
    for (let j = holeCellIndex(4500); j < holeCellIndex(6500) && holes < LIMIT; j++) {
      for (let i = -9; i <= 9 && holes < LIMIT; i++) {
        if (!holeInCell(i, j, disc) || !isLiquidKind(disc.kind)) continue;
        holes++;
        const level = discLevel(i, j, disc);
        const reach = disc.radius * 1.45, n = Math.ceil(2 * reach) + 1;
        const wet: boolean[][] = [], ground: number[][] = [];
        for (let b = 0; b < n; b++) {
          wet.push([]); ground.push([]);
          for (let a = 0; a < n; a++) {
            shoreVertex(disc, level, disc.u - reach + a, disc.s - reach + b, v);
            wet[b].push(v.wet); ground[b].push(v.ground);
            // Level: every wet point is at the one surface height, on ground no higher than it.
            if (v.wet) { assert.equal(v.y, level); assert.ok(v.ground <= level + 0.02, `wet ground ${v.ground} above the surface ${level}`); }
            // Everything else is under the ground, so a triangle that crosses the shore dives under the terrain.
            else assert.ok(v.y <= v.ground, `a dry point at ${v.y} is above the ground at ${v.ground}`);
            // A point that is drawn but not wet is level and under higher ground, which hides it.
            if (v.shown && !v.wet) { assert.equal(v.y, level); assert.ok(v.ground > level); }
          }
        }
        for (let b = 1; b < n - 1; b++) {
          for (let a = 1; a < n - 1; a++) {
            if (!wet[b][a]) continue;
            for (const [db, da] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              if (!wet[b + db][a + da] && level - ground[b + db][a + da] > HANGING_DROP) cliffs++;
            }
          }
        }
      }
    }
    assert.ok(holes >= 20, `only ${holes} pools found to check`);
    // At most a few per pool may spill over a drop (where a much deeper pool runs into this one).
    assert.ok(cliffs <= holes * MAX_CLIFFS_PER_POOL, `${cliffs} places where water ends above a drop in ${holes} pools`);
  } finally {
    setHazardLevelBias(0);
  }
});

/** A drop at the edge of the water larger than this (metres) means the water is hanging over it. */
const HANGING_DROP = 1.5;
const MAX_CLIFFS_PER_POOL = 4;
