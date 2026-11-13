import assert from 'node:assert/strict';
import test from 'node:test';
import { BIOME_LENGTH, SCREE, biomeOfStretch } from '../src/game/biomes.ts';
import { fogEventOf, fogVisibilityAt, type FogEvent } from '../src/game/fog.ts';
import { FOG_LENGTH, FOG_VISIBILITY_THICKEST, FOG_VISIBILITY_THINNEST } from '../src/game/tuning.ts';

const STRETCHES = 4000;
const scree = (): number[] => Array.from({ length: STRETCHES }, (_, i) => i).filter(i => biomeOfStretch(i) === SCREE);

test('about half of the scree stretches have a fog event, and nothing else does', () => {
  const event: FogEvent = { from: 0, to: 0, visibility: 1 };
  const all = scree();
  const foggy = all.filter(stretch => fogEventOf(stretch, event));
  assert.ok(foggy.length / all.length > 0.42 && foggy.length / all.length < 0.58, `${foggy.length} of ${all.length}`);
  for (let stretch = 0; stretch < STRETCHES; stretch++) if (biomeOfStretch(stretch) !== SCREE) assert.equal(fogEventOf(stretch, event), false);
});

test('an event is 400 m long, starts from half way and ends inside the biome, and leaves a half to a tenth of the visibility', () => {
  const event: FogEvent = { from: 0, to: 0, visibility: 1 };
  let thickest = 1, thinnest = 0, earliest = 1, latest = 0, found = 0;
  for (const stretch of scree()) {
    if (!fogEventOf(stretch, event)) continue;
    found++;
    const start = stretch * BIOME_LENGTH;
    assert.equal(event.to - event.from, FOG_LENGTH);
    assert.ok(event.from >= start + BIOME_LENGTH / 2 - 1e-9 && event.to <= start + BIOME_LENGTH + 1e-9, `stretch ${stretch}: ${event.from - start} to ${event.to - start}`);
    assert.ok(event.visibility >= FOG_VISIBILITY_THICKEST && event.visibility <= FOG_VISIBILITY_THINNEST);
    thickest = Math.min(thickest, event.visibility); thinnest = Math.max(thinnest, event.visibility);
    earliest = Math.min(earliest, (event.from - start) / BIOME_LENGTH); latest = Math.max(latest, (event.to - start) / BIOME_LENGTH);
  }
  assert.ok(found > 20);
  // The whole range is used, not one value.
  assert.ok(thickest < 0.14 && thinnest > 0.46, `visibility ${thickest.toFixed(2)} to ${thinnest.toFixed(2)}`);
  assert.ok(earliest < 0.52 && latest > 0.98, `fog from ${earliest.toFixed(2)} to ${latest.toFixed(2)} of the way through`);
});

test('visibility is full outside an event, eases down to the event\'s thickness inside it, and is the same every time', () => {
  const event: FogEvent = { from: 0, to: 0, visibility: 1 };
  const stretch = scree().find(i => fogEventOf(i, event))!;
  fogEventOf(stretch, event);
  const { from, to, visibility } = event;
  assert.equal(fogVisibilityAt(from - 10), 1);
  assert.equal(fogVisibilityAt(to + 10), 1);
  assert.equal(fogVisibilityAt(from), 1);
  assert.ok(Math.abs(fogVisibilityAt((from + to) / 2) - visibility) < 1e-9, 'thickest in the middle');
  assert.ok(fogVisibilityAt(from + 20) < 1 && fogVisibilityAt(from + 20) > visibility, 'easing in');
  assert.equal(fogVisibilityAt(from + 123), fogVisibilityAt(from + 123));
  for (let s = 0; s < 40 * BIOME_LENGTH; s += 7) { const v = fogVisibilityAt(s); assert.ok(v >= FOG_VISIBILITY_THICKEST - 1e-9 && v <= 1); }
});
