/**
 * Every gameplay and world-shape number lives here so the simulation, the
 * meshes and the tests agree on one source of truth. Units are SI: metres,
 * seconds, metres per second.
 */

// --- Ball -----------------------------------------------------------------
/** Radius of a fresh jelly. It wears down as it rolls and grows by merging. */
export const START_RADIUS = 0.6;
/** Worn down to this speck, the jelly is gone and the run is over. */
export const MIN_RADIUS = 0.05;
/** Merging stops adding size as the jelly approaches this. */
export const MAX_RADIUS = 2.4;
/**
 * Radius lost per metre rolled along the ground: a fixed part plus a part
 * proportional to radius. Together they take a fresh jelly to nothing in about
 * 1 km if it merges with no mushrooms, and make a big jelly hungrier, so size
 * has to be kept up rather than banked.
 */
export const WEAR_PER_METRE = 0.00035;
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
export const MIN_SPEED = 6;
/** Braking is at full strength this far above MIN_SPEED and zero at it. */
export const BRAKE_FADE_RANGE = 4;
export const BOOST_ACCEL = 6;
export const BRAKE_ACCEL = 7;
export const STEER_ACCEL = 14;
/** Fraction of ground control authority that remains while airborne. */
export const AIR_CONTROL = 0.35;
/** Top speed, as shown on the HUD (km/h). */
export const MAX_SPEED_KMH = 100;
export const KMH_PER_MS = 3.6;
export const MAX_SPEED = MAX_SPEED_KMH / KMH_PER_MS;
/** Above this speed (m/s) steering strengthens in proportion, keeping the turn rate constant. */
export const STEER_REFERENCE_SPEED = 14;
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
 * little above MAX_SPEED (by DRAG_HEADROOM), so the jelly really does reach
 * the limit and the limit is what holds it there. Coasting settles at roughly
 * 60% of top speed, so W is what gets it there.
 */
const DRAG_HEADROOM = 1.15;
export const DRAG = (GRAVITY * MEAN_SLOPE + BOOST_ACCEL) / (MAX_SPEED * DRAG_HEADROOM) ** 2;
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

// --- Finite differences -----------------------------------------------------
/** Step used to estimate the terrain gradient. */
export const GRADIENT_STEP = 0.25;
