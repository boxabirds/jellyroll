import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { allSampleFiles, HARD_LANDING_FROM, holeVariants, landingVariants, mergeVariants, type HoleSound } from '../src/audio/sample-sounds.ts';
import { CAVE, DUNES, ICE, LAVA, MEADOW, SCREE } from '../src/game/biomes.ts';

const DIR = new URL('../src/audio/samples/', import.meta.url);
const HOLE_SOUNDS: HoleSound[] = ['splash', 'wade', 'stab', 'hiss', 'lava', 'bloop'];
const MIN_RATE = 0.7, MAX_RATE = 1.4, MAX_DELAY_SECONDS = 0.25;

test('every recorded sound the recipes name exists, is a real audio file, and nothing unused is shipped', () => {
  const files = allSampleFiles();
  for (const file of files) {
    assert.ok(existsSync(new URL(file, DIR)), `missing ${file}`);
    assert.ok(statSync(new URL(file, DIR)).size > 500, `${file} is suspiciously small`);
    assert.match(file, /\.(ogg|mp3)$/);
  }
  const shipped = readdirSync(DIR).filter(name => /\.(ogg|mp3)$/.test(name));
  assert.deepEqual(shipped.sort(), [...files].sort(), 'files in samples/ and files the recipes use differ');
});

test('every recipe is well formed: sane pitch, loudness and timing', () => {
  const all = [MEADOW, ICE, DUNES, SCREE, LAVA, CAVE].flatMap(kind => [...mergeVariants(kind)!]).concat([...landingVariants(0), ...landingVariants(1)], HOLE_SOUNDS.flatMap(name => [...holeVariants(name)]));
  for (const variant of all) {
    assert.ok(variant.length >= 1 && variant.length <= 3);
    assert.ok(variant[0].delay === 0, 'the first layer starts at once');
    for (const layer of variant) {
      assert.ok(layer.rate >= MIN_RATE && layer.rate <= MAX_RATE, `${layer.file} rate ${layer.rate}`);
      assert.ok(layer.gain > 0 && layer.gain <= 1);
      assert.ok(layer.delay >= 0 && layer.delay <= MAX_DELAY_SECONDS);
    }
  }
});

test('each kind has the variety chosen for it', () => {
  assert.equal(mergeVariants(MEADOW)!.length, 3, 'three layered combinations for the mushroom');
  assert.equal(mergeVariants(ICE)!.length, 5, 'all five snow crunches');
  assert.ok(mergeVariants(DUNES)!.length >= 3 && mergeVariants(DUNES)!.every(v => v.length === 2), 'the cactus is a wet crunch: two layers');
  // The crystals are the cave's now; the scree has ore.
  const crystal = mergeVariants(CAVE)!;
  assert.ok(mergeVariants(SCREE)!.length >= 3);
  assert.ok(crystal.length >= 7);
  assert.ok(!allSampleFiles().some(file => /bong|bell/i.test(file)), 'no bong or bell for the crystal');
  const ember = mergeVariants(LAVA)!;
  assert.ok(ember.length >= 3 && ember.every(variant => variant[0].rate < 0.85), 'the ember is a thick blob: slowed-down mud and slime');
  assert.ok(ember.every(variant => variant.some(layer => /mud|slime|bubble/.test(layer.file))));
});

test('landings: one soft recipe, and hard ones that pair each heavy thud with the splat', () => {
  assert.equal(landingVariants(0).length, 1);
  assert.equal(landingVariants(HARD_LANDING_FROM - 0.01), landingVariants(0));
  const hard = landingVariants(HARD_LANDING_FROM);
  assert.equal(hard.length, 2);
  assert.deepEqual(hard.map(v => v[0].file).sort(), ['kenney-impact-impactSoft_heavy_000.ogg', 'kenney-impact-impactSoft_heavy_002.ogg']);
  for (const variant of hard) assert.ok(variant.some(layer => layer.file.includes('squishsplat_impact')));
});

test('the holes have real recorded sounds: seven splashes for water, glass and snow for shards, five hisses, fire and bubbles for lava', () => {
  const files = (name: HoleSound) => holeVariants(name).flat().map(layer => layer.file);
  assert.ok(holeVariants('splash').length >= 7 && files('splash').filter(file => file.includes('splash_')).length >= 7);
  assert.ok(files('stab').some(file => file.includes('impactGlass_heavy')) && files('stab').some(file => file.includes('snow')));
  assert.equal(holeVariants('hiss').length, 5);
  assert.ok(files('lava').some(file => file.includes('fire-crackle')) && files('lava').some(file => file.includes('bubble')));
  assert.ok(files('wade').every(file => file.includes('splash_')) && files('bloop').every(file => file.includes('bubble')));
});
