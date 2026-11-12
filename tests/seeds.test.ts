import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectibleKind } from '../src/game/biomes.ts';
import { createSeedPacket, seedPacketInSegment, seedPacketSegment } from '../src/game/seed-packets.ts';
import {
  COLORS_PER_KIND, SEED_COUNT, advanceSeeds, clearSeeds, createSeedField, inFlight, livingSeeds, nearRock, plantSeeds, seedPosition,
  sproutScale,
} from '../src/game/seeds.ts';
import { KIND_NAMES } from '../src/game/mushrooms.ts';
import { createBall, spraySeeds, stepBall, usePowerup, wantPowerup } from '../src/game/physics.ts';
import { POWERUP_SEEDS } from '../src/game/tuning.ts';
import { courseCenter, courseHalfWidth, terrainHeight } from '../src/game/terrain.ts';
import {
  MAX_PLANTED, MUSHROOM_MAX_RADIUS, MUSHROOM_MIN_RADIUS, PHYSICS_STEP, SEED_FAR, SEED_FLIGHT_MIN_SECONDS, SEED_GROW_SECONDS, SEED_NEAR,
  SEED_PACKET_FLOAT_HEIGHT, SEED_PACKET_FREE_UNTIL, SEED_PACKET_SPACING, SEED_VALLEY_FRACTION, START_RADIUS,
} from '../src/game/tuning.ts';
import { sweetColor } from '../src/render/colors.ts';

const COAST = { throttle: 0, steer: 0 };
/** Meadow, well clear of a transition, so every seed sprouts the same kind. */
const MEADOW_S = 700;
const ORIGIN_SIDE = 3;

function spray(key = 12345, s = MEADOW_S) {
  const field = createSeedField();
  const x = courseCenter(s) + ORIGIN_SIDE, z = -s;
  const planted = plantSeeds(field, x, terrainHeight(x, z) + 1, z, key);
  return { field, planted, x, z };
}

test('seed packets are deterministic, float over the valley, and turn up along the course', () => {
  const a = createSeedPacket(), b = createSeedPacket();
  let found = 0;
  const SEGMENTS = 100;
  for (let segment = 0; segment < SEGMENTS; segment++) {
    const has = seedPacketInSegment(segment, a);
    assert.equal(has, seedPacketInSegment(segment, b));
    if (!has) continue;
    found++;
    assert.deepEqual(a, b);
    assert.equal(seedPacketSegment(-a.z), segment);
    assert.ok(Math.abs(a.x - courseCenter(-a.z)) < courseHalfWidth(-a.z), 'packet is outside the valley');
    assert.ok(Math.abs(a.y - terrainHeight(a.x, a.z) - SEED_PACKET_FLOAT_HEIGHT) < 1e-9);
    assert.ok(-a.z >= SEED_PACKET_FREE_UNTIL, 'a packet is too close to the start line');
  }
  assert.ok(found > SEGMENTS * 0.4 && found < SEGMENTS * 0.8, `${found} packets in ${SEGMENTS * SEED_PACKET_SPACING} m`);
  assert.equal(SEED_PACKET_SPACING, 41, 'ten times as many slots as the original 410 m');
  // Ten times as often as before: about one packet every 70 m instead of every 700 m.
  const metres = SEGMENTS * SEED_PACKET_SPACING;
  assert.ok(metres / found < 100 && metres / found > 50, `one packet per ${metres / found} m`);
});

test('a spray throws a whole pile of seeds, the same every time for the same packet', () => {
  const one = spray(777), again = spray(777), other = spray(778);
  assert.ok(one.planted >= SEED_COUNT * 0.8, `only ${one.planted} of ${SEED_COUNT} seeds planted`);
  assert.equal(livingSeeds(one.field), one.planted);
  assert.deepEqual(one.field.items.map(i => [i.x, i.z, i.radius, i.kind, i.look]), again.field.items.map(i => [i.x, i.z, i.radius, i.kind, i.look]));
  assert.notDeepEqual(one.field.items.map(i => i.x), other.field.items.map(i => i.x), 'a different packet should spray differently');
});

test('seeds land down the valley ahead of the jelly, on the ground, off the rocks, in piles', () => {
  const { field, z } = spray();
  const along: number[] = [];
  for (const item of field.items.filter(i => i.alive)) {
    const s = -item.z;
    along.push(s);
    assert.ok(item.z < z, 'a seed landed behind the jelly');
    assert.ok(-item.z - -z > SEED_NEAR - 6 && -item.z - -z < SEED_FAR + 6, `landed ${-item.z - -z} m ahead`);
    assert.ok(Math.abs(item.x - courseCenter(s)) <= courseHalfWidth(s) * SEED_VALLEY_FRACTION + 1e-9, 'a seed landed outside the valley');
    assert.ok(Math.abs(item.y - terrainHeight(item.x, item.z) - item.radius * 0.85) < 1e-9, 'a seed is not resting on the ground');
    assert.ok(!nearRock(item.x, item.z), 'a seed landed on a rock');
    assert.ok(item.radius >= MUSHROOM_MIN_RADIUS && item.radius <= MUSHROOM_MAX_RADIUS);
  }
  // Clumped into piles, not a flat even spread: some gaps are large, some neighbours very close.
  along.sort((p, q) => p - q);
  const gaps = along.slice(1).map((value, i) => value - along[i]);
  assert.ok(Math.max(...gaps) > 6 && Math.min(...gaps) < 1.5, 'seeds should clump into piles');
});

test('each seed sprouts the kind of collectible that grows where it landed, and has valid colours', () => {
  const { field } = spray();
  for (const item of field.items.filter(i => i.alive)) {
    assert.equal(item.kind, collectibleKind(-item.z, 0), `${KIND_NAMES[item.kind]} in the meadow`);
    assert.ok(item.color >= 0 && item.color < COLORS_PER_KIND && item.color2 >= 0 && item.color2 < COLORS_PER_KIND);
    assert.notEqual(item.color, item.color2);
    assert.ok(sweetColor(item.kind, item.color) && sweetColor(item.kind, item.color2), 'missing colour');
  }
  assert.equal(new Set(field.items.filter(i => i.alive).map(i => i.kind)).size, 1);
});

test('a seed flies in an arc, lands, and pops up to full size with a little overshoot', () => {
  const { field } = spray();
  const item = field.items.find(i => i.alive)!;
  const where = { x: 0, y: 0, z: 0 };
  item.age = 0;
  seedPosition(item, where);
  assert.ok(Math.abs(where.x - item.fromX) < 1e-9 && Math.abs(where.z - item.fromZ) < 1e-9, 'a seed starts at the jelly');
  assert.ok(inFlight(item) && sproutScale(item) === 0);
  item.age = item.flight / 2;
  seedPosition(item, where);
  const straight = (item.fromY + item.y) / 2;
  assert.ok(where.y > straight + item.arc * 0.9, `mid-flight height ${where.y} is not above the straight line ${straight}`);
  item.age = item.flight;
  seedPosition(item, where);
  assert.ok(Math.abs(where.x - item.x) < 1e-9 && Math.abs(where.y - item.y) < 1e-9, 'a seed ends where it lands');
  assert.ok(item.flight >= SEED_FLIGHT_MIN_SECONDS);
  let peak = 0;
  for (let t = 0; t <= SEED_GROW_SECONDS + 0.1; t += 0.005) {
    item.age = item.flight + t;
    peak = Math.max(peak, sproutScale(item));
  }
  assert.ok(peak > 1.05 && peak < 1.25, `overshoot ${peak}`);
  item.age = item.flight + SEED_GROW_SECONDS + 1;
  assert.ok(Math.abs(sproutScale(item) - 1) < 1e-9);
});

test('the seeds leave one after another, and uncollected ones expire or are dropped far behind', () => {
  const { field, z } = spray();
  const living = field.items.filter(i => i.alive);
  const ages = living.map(i => i.age);
  assert.ok(Math.min(...ages) < -0.05 && Math.max(...ages) <= 0, 'launches should be staggered');
  advanceSeeds(field, 100, z);
  assert.equal(livingSeeds(field), 0, 'uncollected seeds should expire');
  const again = spray();
  advanceSeeds(again.field, 0.01, again.z - 1000);
  assert.equal(livingSeeds(again.field), 0, 'seeds far behind the jelly should be dropped');
});

test('two sprays fit; a third replaces the oldest rather than failing', () => {
  const field = createSeedField();
  const x = courseCenter(MEADOW_S), z = -MEADOW_S;
  for (let key = 0; key < 3; key++) plantSeeds(field, x, 0, z, key);
  assert.ok(livingSeeds(field) <= MAX_PLANTED && livingSeeds(field) > SEED_COUNT, `${livingSeeds(field)} alive`);
  clearSeeds(field);
  assert.equal(livingSeeds(field), 0);
});

test('a seed cannot be collected in the air, and once sprouted the jelly merges with it exactly once', () => {
  const ball = createBall();
  ball.z = -MEADOW_S; ball.x = courseCenter(MEADOW_S); ball.y = terrainHeight(ball.x, ball.z) + ball.radius;
  spraySeeds(ball, 99);
  assert.ok(ball.seedsSprayed);
  const target = ball.seeds.items.find(i => i.alive)!;
  const first = { x: target.x, z: target.z, radius: target.radius, kind: target.kind };
  // Sit the jelly right on the spot while the seed is still in the air.
  const park = () => { ball.x = first.x; ball.z = first.z; ball.y = terrainHeight(ball.x, ball.z) + ball.radius + 0.2; ball.vx = ball.vy = ball.vz = 0; };
  let airMerges = 0;
  for (let i = 0; i < 20; i++) { park(); target.age = Math.min(target.age, target.flight * 0.5); stepBall(ball, COAST, PHYSICS_STEP); airMerges += ball.pickupCount; }
  assert.equal(airMerges, 0, 'a seed in the air was collected');
  assert.equal(target.alive, true);
  target.age = target.flight + SEED_GROW_SECONDS;
  park();
  stepBall(ball, COAST, PHYSICS_STEP);
  const hit = ball.pickups.slice(0, ball.pickupCount).find(p => p.kind === first.kind && Math.abs(p.radius - first.radius) < 1e-12);
  assert.ok(hit, 'the sprouted collectible was not merged');
  assert.equal(target.alive, false);
  assert.ok(hit.volume > 0 && hit.jellyRadius > 0);
  park();
  stepBall(ball, COAST, PHYSICS_STEP);
  assert.ok(!ball.pickups.slice(0, ball.pickupCount).some(p => Math.abs(p.radius - first.radius) < 1e-12 && p.look === target.look && p.seed === target.seed), 'merged twice');
});

test('rolling through a packet sprays seeds once, and restarting clears them', () => {
  const packet = createSeedPacket();
  let segment = 0;
  while (!seedPacketInSegment(segment, packet)) segment++;
  const ball = createBall();
  ball.x = packet.x; ball.y = packet.y; ball.z = packet.z + 3;
  ball.vx = 0; ball.vy = 0; ball.vz = -10;
  for (let i = 0; i < 120; i++) stepBall(ball, COAST, PHYSICS_STEP);
  // Rolling through a packet only keeps it (slot 3); the seeds go out when the player uses it.
  assert.equal(ball.stock[POWERUP_SEEDS], 1, 'the packet should be picked up exactly once');
  assert.equal(livingSeeds(ball.seeds), 0, 'nothing is sown until it is used');
  assert.equal(ball.seedTakenSegment, segment);
  // A key pressed between steps is used at the start of the next, where the sound and the messages can see it.
  wantPowerup(ball, POWERUP_SEEDS);
  stepBall(ball, COAST, PHYSICS_STEP);
  assert.equal(ball.seedsSprayed, true, 'the step that uses it reports it (the sound plays from that)');
  stepBall(ball, COAST, PHYSICS_STEP);
  assert.equal(ball.seedsSprayed, false, 'and only that step');
  assert.ok(livingSeeds(ball.seeds) >= SEED_COUNT * 0.8, `${livingSeeds(ball.seeds)} seeds in the air`);
  assert.equal(ball.stock[POWERUP_SEEDS], 0);
  assert.equal(usePowerup(ball, POWERUP_SEEDS), false, 'with none left there is nothing to use');
  assert.ok(START_RADIUS > 0);
});
