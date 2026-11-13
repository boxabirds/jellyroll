/**
 * Every gameplay and world-shape number lives here so the simulation, the
 * meshes and the tests agree on one source of truth. Units are SI: metres,
 * seconds, metres per second.
 */

// --- Ball -----------------------------------------------------------------
/** Radius of a fresh jelly. It wears down as it rolls and grows by merging. */
/** The jelly is 20% wider than the original 0.6 m radius: every size below scales with it. */
const JELLY_SIZE_GAIN = 1.2;
export const START_RADIUS = 0.6 * JELLY_SIZE_GAIN;
/** Worn down to this speck, the jelly is gone and the run is over. */
export const MIN_RADIUS = 0.05 * JELLY_SIZE_GAIN;
/** Merging stops adding size as the jelly approaches this. */
/** The largest the jelly can grow: 50% bigger than before (a 2.4 m radius at the original scale). */
const MAX_SIZE_GAIN = 1.5;
export const MAX_RADIUS = 2.4 * JELLY_SIZE_GAIN * MAX_SIZE_GAIN;
/**
 * Radius lost per metre rolled along the ground: a fixed part plus a part
 * proportional to radius. Together they take a fresh jelly to nothing in about
 * 1 km if it merges with no mushrooms, and make a big jelly hungrier, so size
 * has to be kept up rather than banked.
 */
/** Scaled with the jelly, so a bigger jelly lasts as many metres as before, not more. */
export const WEAR_PER_METRE = 0.00035 * JELLY_SIZE_GAIN;
export const WEAR_PER_METRE_PER_RADIUS = 0.0007;
/** Earth gravity plus 30%: the jelly is heavy, hugs the ground and lands with a thump. */
const EARTH_GRAVITY = 9.81;
const GRAVITY_GAIN = 1.3;
export const GRAVITY = EARTH_GRAVITY * GRAVITY_GAIN;

// --- Fixed-step loop --------------------------------------------------------
export const PHYSICS_HZ = 120;
export const PHYSICS_STEP = 1 / PHYSICS_HZ;
export const MAX_SUBSTEPS_PER_FRAME = 8;
export const MAX_FRAME_SECONDS = 0.05;

// --- Player control ---------------------------------------------------------
/** The jelly cannot be stopped: braking fades out as it nears this speed. */
export const MIN_SPEED = 3;
/** Braking is at full strength this far above MIN_SPEED and zero at it. */
export const BRAKE_FADE_RANGE = 2;
export const BOOST_ACCEL = 6;
export const BRAKE_ACCEL = 7;
/** Halved with the speeds, so the turn rate (this over speed) stays the same. */
export const STEER_ACCEL = 7;
/** Fraction of ground control authority that remains while airborne. */
export const AIR_CONTROL = 0.35;
/** Hard top speed, as shown on the HUD (km/h). Only a steep drop gets the jelly near it. */
export const MAX_SPEED_KMH = 150;
export const KMH_PER_MS = 3.6;
export const MAX_SPEED = MAX_SPEED_KMH / KMH_PER_MS;
/** Speed (km/h) that holding W levels off at on an average slope in the first loop; the drag is sized to it. */
export const CRUISE_SPEED_KMH = 50;
export const CRUISE_SPEED = CRUISE_SPEED_KMH / KMH_PER_MS;
/** Above this speed (m/s) steering strengthens in proportion, keeping the turn rate constant. */
export const STEER_REFERENCE_SPEED = 7;
/** Push along the course when something has slowed the jelly below MIN_SPEED. */
export const NUDGE_ACCEL = 12;
/** Below this horizontal speed the heading is taken from the course instead. */
export const HEADING_MIN_SPEED = 1;

// --- Jump -------------------------------------------------------------------
/** Launch speed of a hop; with the heavier gravity it still clears about 2 m. */
export const JUMP_SPEED = 7.4;
/** A jump still counts this long after leaving the ground. */
export const JUMP_COYOTE_SECONDS = 0.1;
/** A press this long before landing still jumps on touchdown. */
export const JUMP_BUFFER_SECONDS = 0.12;

// --- Contact ----------------------------------------------------------------
export const GROUND_RESTITUTION = 0.32;
/** Landings slower than this are absorbed; faster ones bounce. */
export const BOUNCE_MIN_IMPACT = 2.5;
/** Clearance under which the ball still counts as touching the ground. */
export const GROUND_CONTACT_SLOP = 0.03;
export const ROCK_RESTITUTION = 0.55;
/** Along-surface speed lost per m/s of impact into a rock. */
export const ROCK_FRICTION = 0.25;
/** Sideways push (m/s²) that slides a slow jelly off a rock it is resting against. */
export const ROCK_SLIDE_ACCEL = 14;
/** Rate (1/s) at which airborne spin relaxes; grounded spin is pure rolling. */
export const SPIN_FOLLOW_RATE = 30;

// --- Course shape -----------------------------------------------------------
export const WORLD_SEED = 20261110;
/** Average descent per metre travelled. */
export const MEAN_SLOPE = 0.24;
/**
 * Quadratic air drag (1/m). On the average slope it would let W level off a
 * little above CRUISE_SPEED (by DRAG_HEADROOM). Coasting settles at roughly
 * 60% of that, so W is what gets it there. Each loop of the biomes divides
 * this by the square of its speed factor (biomes.ts), which raises both
 * speeds by that factor.
 */
const DRAG_HEADROOM = 1.15;
export const DRAG = (GRAVITY * MEAN_SLOPE + BOOST_ACCEL) / (CRUISE_SPEED * DRAG_HEADROOM) ** 2;
/**
 * Drag while W is fully held: low enough that W levels off a little above
 * MAX_SPEED on an average slope, so the jelly can really reach the cap. Held
 * W eases the drag from DRAG down to this (the "tuck"), and releasing it eases
 * back, so letting go at speed slows the jelly over a couple of seconds, not at once.
 */
export const TUCKED_DRAG = (GRAVITY * MEAN_SLOPE + BOOST_ACCEL) / (MAX_SPEED * DRAG_HEADROOM) ** 2;
/** Per second, how fast the tuck builds while W is held and fades once it is let go. */
export const TUCK_RISE_RATE = 1.5;
export const TUCK_FALL_RATE = 0.5;
/**
 * Long undulations of the descent. Sum of amplitude*2π/wavelength stays below
 * MEAN_SLOPE so the course never turns uphill on average.
 */
export const SLOPE_WAVES = [
  { amplitude: 12, wavelength: 520, phase: 0.6 },
  { amplitude: 2, wavelength: 170, phase: 2.1 },
] as const;
/** Sideways meander of the valley centre line. */
export const MEANDER_WAVES = [
  { amplitude: 26, wavelength: 640, phase: 0 },
  { amplitude: 7, wavelength: 260, phase: 1.3 },
] as const;
export const VALLEY_HALF_WIDTH = 26;
export const VALLEY_HALF_WIDTH_SWING = 9;
export const VALLEY_WIDTH_WAVELENGTH = 430;
/** Gentle bowl inside the valley (height per metre squared from the centre). */
export const BOWL_CURVATURE = 0.006;
/**
 * Banks outside the valley half width rise in a smooth S-curve to a rounded
 * ridge RIDGE_DISTANCE further out, then fall away behind it. Seen from the
 * valley the skyline is that ridge, never the edge of the drawn terrain.
 */
export const RIDGE_HEIGHT = 34;
export const RIDGE_DISTANCE = 34;
/** How far past the ridge the back slope keeps falling before it levels off. */
export const RIDGE_BACK_FRACTION = 1.5;
/** The jelly is turned back this far short of the ridge crest (metres). */
export const RIDGE_BARRIER_INSET = 3;
/** Fraction of outward speed returned when the jelly meets that barrier. */
export const RIDGE_BARRIER_RESTITUTION = 0.3;

// --- Surface relief ---------------------------------------------------------
export const HILL_WAVELENGTH = 70;
export const HILL_AMPLITUDE = 3.2;
export const MOGUL_WAVELENGTH = 18;
export const MOGUL_AMPLITUDE = 1.0;
/**
 * Three more scales of relief between the broad hills and the fine ripple, so
 * the ground is not one smooth undulation:
 *   - rollers: ridges lying across the course, a few car-lengths apart;
 *   - knolls: small humps and hollows everywhere, not only on rough stretches;
 *   - grooves: shallow channels running down the course that the jelly can ride.
 * Their steepest faces stay far below what the course's pull can climb (a test
 * checks every slope against that), so none of it can trap the jelly.
 */
export const ROLLER_WAVELENGTH = 30;
export const ROLLER_AMPLITUDE = 0.75;
/** Rollers bend across the valley over this distance, so they are not ruler-straight. */
export const ROLLER_SKEW_WAVELENGTH = 90;
export const KNOLL_WAVELENGTH = 12;
export const KNOLL_AMPLITUDE = 0.38;
export const GROOVE_WIDTH = 9;
export const GROOVE_LENGTH = 140;
export const GROOVE_AMPLITUDE = 0.32;
export const RIPPLE_WAVELENGTH = 8;
export const RIPPLE_AMPLITUDE = 0.14;
/** Length scale over which smooth stretches give way to rough ones. */
export const ROUGHNESS_WAVELENGTH = 320;
/** The first metres are kept smooth so the run starts gently. */
export const START_SMOOTH_FROM = 30;
export const START_SMOOTH_TO = 160;

// --- Kickers (launch ramps) -------------------------------------------------
export const KICKER_SPACING = 180;
export const KICKER_CHANCE = 0.65;
export const KICKER_FIRST_SEGMENT = 1;
export const KICKER_MARGIN = 20;
export const KICKER_LENGTH = 14;
export const KICKER_FALLOFF = 5;
export const KICKER_HEIGHT = 2.1;
export const KICKER_HALF_WIDTH = 6.5;
/** Fraction of the half width that is flat-topped before the sides slope off. */
export const KICKER_CORE_FRACTION = 0.6;
/** Kickers are placed within this fraction of the valley half width. */
export const KICKER_LATERAL_FRACTION = 0.5;

// --- Rocks ------------------------------------------------------------------
export const ROCK_CELL = 14;
export const ROCK_MIN_RADIUS = 0.7;
export const ROCK_MAX_RADIUS = 2.3;
/** Probability that a cell holds a rock in the densest stretches. */
export const ROCK_MAX_DENSITY = 0.42;
export const ROCK_MIN_DENSITY_FRACTION = 0.15;
export const ROCK_DENSITY_WAVELENGTH = 380;
export const ROCK_FREE_UNTIL = 90;
export const ROCK_FULL_DENSITY_AT = 260;
/** Rocks reach this fraction of the way up a bank toward the ridge, no further. */
export const ROCK_BANK_LIMIT = 0.8;
/** Rock centre sits this fraction of its radius below the ground. */
export const ROCK_EMBED = 0.3;
/** No rocks where a kicker is taller than this, so ramps stay usable. */
export const ROCK_KICKER_CLEARANCE = 0.05;

// --- Mushrooms (the little jellies to merge with) -------------------------------
export const MUSHROOM_CELL = 4;
export const MUSHROOM_MIN_RADIUS = 0.2;
export const MUSHROOM_MAX_RADIUS = 0.5;
/** Chance that a cell inside a mushroom patch holds a mushroom. */
export const MUSHROOM_PATCH_DENSITY = 0.75;
/** Mushrooms gather in patches about this wide, with bare ground between them to steer across. */
export const MUSHROOM_PATCH_WAVELENGTH = 36;
/** Patch noise above this value grows mushrooms; higher means sparser patches. */
export const MUSHROOM_PATCH_THRESHOLD = 0.22;
export const MUSHROOM_PATCH_FEATHER = 0.3;
export const MUSHROOM_FREE_UNTIL = 25;
/** Mushrooms stay this far inside the valley edge (negative: a little up the bank). */
export const MUSHROOM_EDGE_MARGIN = -5;
/** Mushroom centre height above the ground, in mushroom radii: it sits slightly squashed. */
export const MUSHROOM_REST_HEIGHT = 0.85;
/** The jelly absorbs a mushroom once their surfaces overlap by this fraction of the mushroom. */
export const MUSHROOM_TOUCH = 0.85;
export const MUSHROOM_COLOR_COUNT = 6;
/** How many merges are remembered so a hashed mushroom does not grow back. */
export const MUSHROOM_LEDGER_SIZE = 512;
/** Merges reported per physics step (a big jelly can swallow several at once). */
export const MAX_PICKUPS_PER_STEP = 4;

// --- Merge animation ----------------------------------------------------------
// After piece 2 of xiuxiueig: two jellies first squash against each other, then
// blend with a smooth union whose radius grows while their centres are drawn
// together, then fuse into one that wobbles. Physics merges instantly; this is
// only how the merge is shown, so none of it changes the gameplay.
/**
 * Every phase runs this many times faster than piece 2's proportions (which were
 * 0.45 s of approach, 0.3 s of contact and 1.5 s of blend here at first).
 */
const MERGE_SPEED_UP = 1.5;
/** Speed (m/s) at which a mushroom pulled from a distance flies in, and the longest that flight lasts. */
export const MERGE_APPROACH_SPEED = 16 * MERGE_SPEED_UP;
export const MERGE_APPROACH_MAX_SECONDS = 0.45 / MERGE_SPEED_UP;
/** Pressing against the jelly (piece 2: 0.25 s of squash before a blend), then blending. */
export const MERGE_CONTACT_SECONDS = 0.3 / MERGE_SPEED_UP;
export const MERGE_BLEND_SECONDS = 1.5 / MERGE_SPEED_UP;
/** How far the mushroom presses into the jelly during contact, in mushroom radii. */
export const MERGE_PRESS = 0.2;
/** Fraction of its height the mushroom loses at full squash. */
export const MERGE_SQUASH = 0.32;
/** Depth of the dent it leaves in the jelly at full contact, in metres at most (also capped by half the jelly radius). */
export const MERGE_DENT_DEPTH = 0.16;
/** Centres end this fraction of (jelly + mushroom radius) apart: piece 2's mergeCompleteFraction. */
export const MERGE_FUSE_FRACTION = 0.35;
/** The blend radius grows from this to that, in mushroom radii. */
export const MERGE_BLEND_K_START = 0.1;
export const MERGE_BLEND_K_END = 1.1;
/** The union is drawn around a sphere this much larger than the mushroom, so the mushroom stays inside it. */
export const MERGE_UNION_FATTEN = 1.15;
/** Fraction of the blend over which the union switches on. */
export const MERGE_UNION_IN = 0.2;
/** Concurrent merges shown; one more finishes the oldest at once. */
export const MAX_MERGES = 10;

// --- Magnet power-up ----------------------------------------------------------
/** How long a magnet lasts once picked up. */
export const MAGNET_SECONDS = 10;
/** While it lasts, mushrooms within this distance of the jelly's surface are pulled in. */
export const MAGNET_RADIUS = 9;
/** One stretch of course this long holds at most one magnet. */
export const MAGNET_SPACING = 320;
export const MAGNET_CHANCE = 0.75;
/** Magnets keep this far from either end of their stretch, so the first is never at the start line. */
export const MAGNET_MARGIN = 70;
/** Magnets sit within this fraction of the valley half width of its centre line. */
export const MAGNET_LATERAL_FRACTION = 0.55;
/** Height of the floating magnet's centre above the ground. */
export const MAGNET_FLOAT_HEIGHT = 1.6;
/** The magnet is picked up when the jelly's surface comes this close to its centre. */
export const MAGNET_PICKUP_RADIUS = 1.8;

// --- Seed packet power-up -----------------------------------------------------
/**
 * Packets are ten times as frequent as the original 410 m slots: ten times as
 * many slots, each with the same chance of holding one. (The chance itself cannot
 * be multiplied: 0.6 x 10 is more than certain.) At most one per slot.
 */
const SEED_PACKET_FREQUENCY_GAIN = 10;
export const SEED_PACKET_SPACING = 410 / SEED_PACKET_FREQUENCY_GAIN;
export const SEED_PACKET_CHANCE = 0.6;
/** Packets keep this far from either end of their slot (the original 60 m, scaled), so neighbours are never touching. */
export const SEED_PACKET_MARGIN = 60 / SEED_PACKET_FREQUENCY_GAIN;
/** No packets in the first stretch of the run, so it starts with the jelly rolling, not planting. */
export const SEED_PACKET_FREE_UNTIL = 100;
export const SEED_PACKET_LATERAL_FRACTION = 0.55;
export const SEED_PACKET_FLOAT_HEIGHT = 1.6;
export const SEED_PACKET_PICKUP_RADIUS = 1.8;
/** A packet sprays this many piles, each with this many seeds. */
export const SEED_PILES = 4;
export const SEEDS_PER_PILE = 7;
/** Piles land between these distances (metres of course) ahead of the jelly. */
export const SEED_NEAR = 14;
export const SEED_FAR = 78;
/** Seeds scatter this far (metres) around the middle of their pile. */
export const SEED_PILE_RADIUS = 5;
/** How far a pile leans toward the jelly's own side of the valley (0 = random, 1 = right on its line). */
export const SEED_LATERAL_PULL = 0.5;
/** Seeds keep inside this fraction of the valley half width. */
export const SEED_VALLEY_FRACTION = 0.8;
/** Flight time is this plus this per metre, and the arc peaks this high per metre of flight. */
export const SEED_FLIGHT_MIN_SECONDS = 0.5;
export const SEED_FLIGHT_SECONDS_PER_METRE = 0.011;
export const SEED_ARC_HEIGHT_PER_METRE = 0.12;
/** The seeds leave over this long, not all in one instant. */
export const SEED_STAGGER_SECONDS = 0.22;
/** A landed seed sprouts into its collectible over this long (with a little overshoot). */
export const SEED_GROW_SECONDS = 0.35;
/** Sprouted collectibles are on the big side: radius is picked from this share of the range upward. */
export const SEED_MIN_SIZE_SHARE = 0.4;
/** The most planted collectibles alive at once, and how long one lasts if it is never collected. */
/** Whole sprays that can be out at once (flying, sprouting or waiting to be collected) before the oldest seeds are given up. */
export const SEED_SPRAYS_KEPT = 5;
export const MAX_PLANTED = SEED_PILES * SEEDS_PER_PILE * SEED_SPRAYS_KEPT;
export const SEED_LIFETIME_SECONDS = 45;
/** Planted collectibles this far behind the jelly (metres) are dropped. */
export const SEED_BEHIND_DISTANCE = 30;
/** Tries to find a spot clear of rocks for one seed. */
export const SEED_PLACEMENT_TRIES = 5;

// --- Snow ---------------------------------------------------------------------
// Rolling fast through snow packs it onto the jelly like a snowball. The coat protects against wear but makes
// the jelly hard to steer; slow down and it falls off again.
/** Metres of snow rolled over at speed to build a full coat. */
export const SNOW_FULL_METRES = 140;
/** Below this multiple of the minimum speed the coat starts to fall off (more quickly the slower it is). */
export const SNOW_SHED_SPEED_FACTOR = 1.6;
/** Fraction of the coat lost per second at a standstill; per second rolling on bare ground (scaled by how much of the ground is not snow); and per second in the air off the snow. */
export const SNOW_SHED_RATE = 0.6;
export const SNOW_SCRAPE_RATE = 0.45;
export const SNOW_MELT_RATE = 0.08;
/** At a full coat, steering is this much weaker and wear this much slower. */
export const SNOW_STEER_LOSS = 0.8;
export const SNOW_WEAR_PROTECTION = 0.85;

// --- Holes (the obby) ---------------------------------------------------------
// Each biome has its own kind of hole: ponds (Meadow), ice shards (Ice), oases (Dunes),
// steam vents (Scree), lava (Lava). They start small and sparse and grow with every
// biome passed. Three lanes are always kept clear, so there are always three ways through.
/** No holes until here; their number ramps up to full by HAZARD_FULL_AT. */
export const HAZARD_FREE_UNTIL = 220;
export const HAZARD_FULL_AT = 520;
/** Holes are placed one per grid cell of this size (metres), in valley coordinates. */
export const HAZARD_CELL = 12;
/** Holes grow as 1 - exp(-biomes passed / this), so each loop of the five biomes adds less but never stops. */
export const HAZARD_GROWTH_BIOMES = 4;
/** Chance a cell holds a hole, and a hole's radius, at the start and in the limit. A hole's radius never exceeds HAZARD_CELL. */
export const HAZARD_CHANCE_START = 0.3;
export const HAZARD_CHANCE_END = 0.95;
export const HAZARD_RADIUS_START = 2.4;
export const HAZARD_RADIUS_END = 9.2;
/**
 * A hole's edge is not a circle: its radius varies round it by these fractions of the radius (three waves of 2, 3
 * and 5 lobes, each with its own phase). The biggest a hole can reach is HAZARD_RADIUS_END times one plus all
 * three, which must stay within HAZARD_CELL.
 */
export const HAZARD_EDGE_WAVES = [0.14, 0.1, 0.06] as const;
/** Each hole is this fraction smaller than the limit at random, at most. */
export const HAZARD_RADIUS_SPREAD = 0.4;
/** Metres over which a hole's edge goes from fully in to fully out. */
export const HAZARD_EDGE = 1.3;
/** How far (metres) a hole sinks below the ground at its centre. */
export const HAZARD_DEPTH = 0.4;
/**
 * Ponds, oases, icy water and lava are liquids, and liquids lie flat. A liquid hole is a basin cut into the
 * ground, with a ragged outline (HAZARD_EDGE_WAVES). Its surface is level with the lowest point of its rim, where
 * it would spill, so it is held in on every side. The basin's floor is flat, HAZARD_POOL_DEPTH below that, and
 * its walls climb from the floor at HAZARD_WALL_SLOPE until they meet the ground. Ground higher than that is
 * cut away by at most HAZARD_CUT_MAX, so on steep ground only the low part of the basin is deep enough to
 * hold any liquid, under tall steep sides. The cut fades out over HAZARD_CUT_TAIL metres beyond the rim.
 * Where holes overlap the deeper cut wins, so pools join. The jelly is in the liquid once the ground under
 * it is below the surface, with a margin of HAZARD_WET_FADE metres to ease in.
 */
export const HAZARD_POOL_DEPTH = 0.5;
export const HAZARD_WALL_SLOPE = 0.6;
/** The flat floor reaches this fraction of the radius from the rim inward, at least (the walls climb over the rest). */
export const HAZARD_WALL_FRACTION = 0.3;
/** (No deeper than about the jelly's own height: in a deeper pit it drops out of sight behind the pit's wall.) */
export const HAZARD_CUT_MAX = 1.3;
export const HAZARD_CUT_TAIL = 12;
export const HAZARD_WET_FADE = 0.15;
/** Points around a divot's rim sampled to find its lowest. */
export const HAZARD_RIM_SAMPLES = 48;
/** The ground is also looked at this far outside the rim (metres): the lowest of all of it is where the water would spill. */
export const HAZARD_RIM_MARGINS: readonly number[] = [0, 1.5];
/** The clear lanes: how many, how far apart, how much each wanders, how wide (half width) at first and in the limit, and the soft edge. */
export const HAZARD_LANES = 3;
export const HAZARD_LANE_SPACING = 8.4;
export const HAZARD_LANE_WANDER = 1.2;
export const HAZARD_LANE_WAVELENGTH = 70;
export const HAZARD_LANE_HALF_START = 3.1;
export const HAZARD_LANE_HALF_END = 2.5;
export const HAZARD_LANE_SOFT = 2.5;
/** Holes reach this far beyond the barrier that turns the jelly back from the ridge. */
export const HAZARD_BANK_OVERRUN = 2;
/**
 * Effects at full depth, per hole kind (by biome index):
 *   slow  - horizontal speed lost per second as a fraction (never below the minimum speed);
 *   melt  - fraction of the jelly's radius lost per second;
 *   stab  - fraction of the radius torn off by each shard, one per HAZARD_STAB_SPACING metres travelled;
 *   lift  - upward acceleration (m/s^2) in pulses, over a column HAZARD_VENT_HEIGHT high.
 */
export const HAZARD_EFFECTS = [
  { slow: 3, melt: 0.08, stab: 0, lift: 0 },
  { slow: 0.3, melt: 0, stab: 0.05, lift: 0 },
  { slow: 3, melt: 0.08, stab: 0, lift: 0 },
  { slow: 0.2, melt: 0.05, stab: 0, lift: 46 },
  { slow: 1.8, melt: 0.14, stab: 0, lift: 0 },
  // Cave pool: like a pond.
  { slow: 3, melt: 0.08, stab: 0, lift: 0 },
] as const;
/** Holes also hurt more as they grow: melt, slowing and stabbing are this much stronger at full growth (so 2 means double). */
export const HAZARD_HARDER_GAIN = 1;
export const HAZARD_STAB_SPACING = 3;
/** Speed kept after a stab. */
export const HAZARD_STAB_KEEP = 0.92;
export const HAZARD_VENT_HEIGHT = 7;
/** Vents pulse: this many pulses per second, a fraction of each pulse lifting, and how the phase shifts across the ground. */
export const HAZARD_VENT_RATE = 0.9;
export const HAZARD_VENT_DUTY = 0.3;
export const HAZARD_VENT_PHASE_PER_METRE = 0.017;

// --- Finite differences -----------------------------------------------------
/** Step used to estimate the terrain gradient. */
export const GRADIENT_STEP = 0.25;

// --- Shields (immunity badges) -----------------------------------------------
/** Collectibles of one biome's kind needed to reach each shield level, one entry per level (each is on top of the last). */
export const SHIELD_STEPS: readonly number[] = [100, 200, 300];
/** How much of that biome's wear a shield of each level takes away (a fraction of the original), starting at level 1. */
export const SHIELD_REDUCTION: readonly number[] = [0.1, 0.3, 0.6];

// --- Glass marble power-up ----------------------------------------------------
/** The jelly is glass for this long: no wear, no melting, no trail. */
export const GLASS_SECONDS = 24;
/** The marble turns from jelly to glass, and back, over this long (so the look and the sound ease in and out). */
export const GLASS_EASE_SECONDS = 0.35;
/**
 * Each biome's stretch of course has between GLASS_PER_BIOME_MIN and GLASS_PER_BIOME_MAX marbles to find, spread over
 * GLASS_SLOTS evenly spaced places (a different two to four of them used in each biome).
 */
export const GLASS_PER_BIOME_MIN = 2;
export const GLASS_PER_BIOME_MAX = 4;
export const GLASS_SLOTS = 4;
export const GLASS_MARGIN = 40;
export const GLASS_LATERAL_FRACTION = 0.3;
export const GLASS_FLOAT_HEIGHT = 1.6;
/** No marbles before the second biome: the first stretch is too gentle for one to be worth having. */
export const GLASS_FREE_UNTIL = 0;
export const GLASS_PICKUP_RADIUS = 1.8;
/** The marble is this many times heavier than the jelly: in the air it comes down this much harder, and it bounces this much less. (On the ground, where its weight would only make it faster downhill, it is the same.) */
export const GLASS_WEIGHT = 2;

/** A glass marble smashes a rock it hits and loses this share of its speed doing so. */
export const GLASS_BREAK_KEEP = 0.9;
/** At most this many rocks are reported broken by one physics step. */
export const MAX_BROKEN_PER_STEP = 4;

// --- Bees ---------------------------------------------------------------------
export const BEE_MAX = 4;
/** Collectibles a bee must have brought in to reach each level, one entry per level (each on top of the last). Level n carries n + 1. */
export const BEE_STEPS: readonly number[] = [100, 200, 300, 400];
/** A biome's stretch of course holds a bee to find with this chance (at most one). */
export const BEE_CHANCE = 0.5;
export const BEE_MARGIN = 250;
export const BEE_LATERAL_FRACTION = 0.5;
export const BEE_FLOAT_HEIGHT = 1.3;
export const BEE_FREE_UNTIL = 120;
export const BEE_PICKUP_RADIUS = 1.8;
/** The most a bee can ever carry at once (a level 4 bee). */
export const BEE_MAX_CARGO = BEE_STEPS.length + 1;
/** Bees look for collectibles this far around a point this far ahead of the jelly, refreshing the list this often. */
export const BEE_SEARCH_RADIUS = 18;
export const BEE_SEARCH_AHEAD = 8;
export const BEE_SCAN_SECONDS = 0.3;
export const BEE_MAX_CANDIDATES = 48;
/** A bee flies at least this fast, and this many times the jelly's speed (plus the extra) so it can always catch up. */
export const BEE_MIN_SPEED = 16;
export const BEE_SPEED_FACTOR = 1.3;
export const BEE_SPEED_EXTRA = 6;
/** How quickly a bee's velocity follows what it wants (1/s). */
export const BEE_STEER_RATE = 9;
/** A bee takes a collectible within this distance of it, and gives its cargo to the jelly within this of its skin. */
export const BEE_GRAB_DISTANCE = 0.45;
export const BEE_DELIVER_REACH = 0.5;
/** A bee near its target slows down inside this distance, so it settles on it. */
export const BEE_SETTLE_DISTANCE = 1.5;
/** Collectibles this far behind the jelly (metres of course) are given up on. */
export const BEE_GIVE_UP_BEHIND = 10;
/** Heeling: beside the jelly this far from its skin, each further pair this much further out and back; and how hard it is pulled to its place (1/s). */
export const BEE_HEEL_SIDE = 0.9;
export const BEE_HEEL_RANK_STEP = 0.9;
export const BEE_HEEL_BACK = 0.3;
export const BEE_HEEL_BACK_STEP = 0.8;
export const BEE_HEEL_STIFFNESS = 5;
export const BEE_HOVER_BOB = 0.12;
export const BEE_BOB_RATE = 7;
export const BEE_GROUND_CLEARANCE = 0.3;
/** A bee bringing something back flies this much higher above the ground, so what it carries does not drag in the grass. */
export const BEE_CARRY_CLEARANCE = 1.2;

// --- Damage numbers -----------------------------------------------------------
/** Wear and melting are added up and shown as "-N cm" once they come to this many centimetres (of diameter)... */
export const DAMAGE_POPUP_MIN_CM = 1;
/** ...and no more often than this. */
export const DAMAGE_POPUP_GAP_SECONDS = 0.4;

// --- Cave: the hill it runs through ------------------------------------------
/**
 * The cave is a tunnel through a hill, and the hill is the ground itself: for the length of the cave the banks either side
 * of the valley rise by this much (metres), starting this far beyond the valley floor and fully risen this far beyond it.
 * At each mouth the rise comes up over CAVE_PORTAL metres of course, which is the slope of the hillside the course runs into.
 */
export const CAVE_HILL_RISE = 120;
export const CAVE_WALL_FROM = 20;
export const CAVE_WALL_TO = 62;
export const CAVE_PORTAL = 90;

// --- Cave: stalagmites and stalactites ----------------------------------------
/** One cell this size (metres) holds at most one stalagmite and at most one stalactite. */
export const SPIKE_CELL = 6;
/** Chance a cell in the cave holds a stalagmite, and a stalactite. */
export const STALAGMITE_CHANCE = 0.42;
export const STALACTITE_CHANCE = 0.42;
/** A stalagmite's base radius (smallest, largest), and its height in radii (least, most). */
export const STALAGMITE_MIN_RADIUS = 0.35;
export const STALAGMITE_MAX_RADIUS = 0.95;
export const STALAGMITE_MIN_ASPECT = 3;
export const STALAGMITE_MAX_ASPECT = 5.5;
/** The jelly collides with a stalagmite as an upright post this share of its base radius wide, up to this share of its height. */
export const STALAGMITE_POST_RADIUS = 0.65;
export const STALAGMITE_POST_HEIGHT = 0.8;
export const STALAGMITE_RESTITUTION = 0.3;
/** They stand this far beyond the valley floor up the banks, at most. */
export const SPIKE_BANK_REACH = 7;
/** A stalactite hangs from the cave's roof; its tip is never nearer the ground than this. Its length (shortest, longest) and base radius. */
export const STALACTITE_MIN_TIP = 5;
export const STALACTITE_MIN_LENGTH = 3;
export const STALACTITE_MAX_LENGTH = 24;
export const STALACTITE_MIN_RADIUS = 0.35;
export const STALACTITE_MAX_RADIUS = 2;
/** This share of stalactites fall as the jelly comes near. */
export const STALACTITE_FALL_CHANCE = 0.2;
/** One lets go when the jelly would arrive under it in about the time it takes to fall (times this), within these distances. */
export const STALACTITE_LEAD = 1.05;
export const STALACTITE_TRIGGER_MIN = 7;
export const STALACTITE_TRIGGER_MAX = 48;
/** How often (seconds) the cave is looked over for one about to fall, and the most falling at once. */
export const STALACTITE_SCAN_SECONDS = 0.1;
export const MAX_FALLERS = 4;
/** A falling stalactite that hits the jelly takes this share of its radius and leaves it this share of its speed. */
export const STALACTITE_DAMAGE = 0.07;
export const STALACTITE_HIT_KEEP = 0.6;
/** It hits if its tip comes within this (plus the two radii) of the jelly. */
export const STALACTITE_HIT_MARGIN = 0.15;
/** A marble that knocks a stalagmite over keeps this share of its speed. */
export const STALAGMITE_TOPPLE_KEEP = 0.95;
/** At most this many stalagmites are reported knocked over, and stalactites landed, by one physics step. */
export const MAX_SPIKE_EVENTS = 4;

/**
 * Power-ups are kept, not used the moment they are found: the number keys use them. Slot 1 is the magnet, 2 the glass marble,
 * 3 a seed packet, 4 a freeze ray. At most STOCK_MAX of each are carried.
 */
export const POWERUP_MAGNET = 0;
export const POWERUP_GLASS = 1;
export const POWERUP_SEEDS = 2;
export const POWERUP_FREEZE = 3;
export const POWERUP_SLOTS = 4;
export const STOCK_MAX = 9;

// --- Freeze ray ---------------------------------------------------------------
/** The freeze ray's crystals float like the marbles (two to four in every biome) but are not met until the second loop of the course. */
export const FREEZE_FLOAT_HEIGHT = 1.6;
export const FREEZE_LATERAL_FRACTION = 0.3;
export const FREEZE_PICKUP_RADIUS = 1.8;
/** Frozen areas are round patches of this radius (metres), laid at these distances ahead of the jelly and these offsets to its right. */
export const FREEZE_PATCH_RADIUS = 3.4;
export const FREEZE_DISTANCES: readonly number[] = [3, 6, 9, 12];
export const FREEZE_SIDES: readonly number[] = [-2.4, 0, 2.4];

// --- Fog in the scree ----------------------------------------------------------
/** Each scree stretch has this chance of a fog event. */
export const FOG_CHANCE = 0.5;
/** A fog event lasts this many metres, and starts no earlier than this share of the way through the biome (and ends inside it). */
export const FOG_LENGTH = 400;
export const FOG_EARLIEST_SHARE = 0.5;
/** How much of normal visibility is left at the thickest: somewhere from the first to the second of these. */
export const FOG_VISIBILITY_THICKEST = 0.1;
export const FOG_VISIBILITY_THINNEST = 0.5;
/** The fog thickens over this many metres at the start of the event and thins over as many at its end. */
export const FOG_RAMP = 80;
