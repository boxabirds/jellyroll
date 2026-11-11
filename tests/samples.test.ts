import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { allSampleFiles, HARD_LANDING_FROM, landingVariants, mergeVariants } from '../src/audio/sample-sounds.ts';
import { DUNES, ICE, LAVA, MEADOW, SCREE } from '../src/game/biomes.ts';

const DIR = new URL('../src/audio/samples/', import.meta.url);
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
  const all = [MEADOW, ICE, DUNES, SCREE].flatMap(kind => [...mergeVariants(kind)!]).concat([...landingVariants(0), ...landingVariants(1)]);
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
  const crystal = mergeVariants(SCREE)!;
  assert.ok(crystal.length >= 7);
  assert.ok(!allSampleFiles().some(file => /bong|bell/i.test(file)), 'no bong or bell for the crystal');
  assert.equal(mergeVariants(LAVA), undefined, 'the ember keeps the synthesised sound');
});

test('landings: one soft recipe, and hard ones that pair each heavy thud with the splat', () => {
  assert.equal(landingVariants(0).length, 1);
  assert.equal(landingVariants(HARD_LANDING_FROM - 0.01), landingVariants(0));
  const hard = landingVariants(HARD_LANDING_FROM);
  assert.equal(hard.length, 2);
  assert.deepEqual(hard.map(v => v[0].file).sort(), ['kenney-impact-impactSoft_heavy_000.ogg', 'kenney-impact-impactSoft_heavy_002.ogg']);
  for (const variant of hard) assert.ok(variant.some(layer => layer.file.includes('squishsplat_impact')));
});
