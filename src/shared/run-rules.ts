/**
 * Rules shared by the game (browser) and the score server (Worker), so both sides use one definition.
 * Distances are metres and times are seconds unless a name says otherwise.
 */
import { MAX_SPEED } from '../game/tuning.ts';

/** How often a running game checks in with the server. */
export const HEARTBEAT_SECONDS = 5;
/** Longest silence between check-ins before a run stops being verified. Covers a tab left in the background. */
export const MAX_GAP_SECONDS = 300;
/** Longest run the server will turn into a score. */
export const MAX_RUN_SECONDS = 2 * 60 * 60;
/** Extra distance allowed on top of top speed, for timing jitter and the first steps. */
export const SLACK_METRES = 60;
/** Fraction added to the top speed's distance, for network timing noise between the game and the server. */
export const SPEED_TOLERANCE = 0.1;
/** Most letters or digits in a name. */
export const NAME_MAX_LETTERS = 9;
/** Scores shown per page of the table. */
export const TABLE_PAGE_SIZE = 10;
/** The leaderboard: only a roll that would rank this high (or higher) is offered a name and put on it. */
export const LEADERBOARD_SIZE = 10;
/** How long the game waits for the server before it plays on without it (milliseconds). */
export const SERVER_TIMEOUT_MS = 4000;
/** Scores a single address may post per flood window. */
export const FLOOD_ALLOWANCE = 5;
/** Length of a flood window (seconds). */
export const FLOOD_WINDOW_SECONDS = 600;
/** Millisecond conversion. */
export const MS_PER_SECOND = 1000;

/** The farthest a jelly could have rolled in a number of seconds, even at top speed the whole time. */
export function maxDistance(seconds: number): number {
  return Math.max(0, seconds) * MAX_SPEED * (1 + SPEED_TOLERANCE) + SLACK_METRES;
}

/** Why a score was not counted. The server never says more than this. */
export type Refusal = 'not-verified' | 'too-long' | 'not-possible' | 'not-top' | 'bad-name' | 'busy' | 'challenge';
