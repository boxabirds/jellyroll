/**
 * The end of a run on the world table: sign the score with giant letters, send it, and show the table. Also the table
 * on demand. This is the one place that ties the run session, the name entry and the table together.
 */
import { solveChallenge } from './challenge.ts';
import { NameEntry } from './name-entry.ts';
import type * as THREE from 'three/webgpu';
import type { LetterStage } from '../world/jelly-letters/letter-stage.ts';
import { RunSession } from './run-session.ts';
import { Scoreboard } from './scoreboard.ts';
import type { SubmitResult } from './run-session.ts';
import { LEADERBOARD_SIZE } from '../shared/run-rules.ts';

/** Wait this long after the jelly wears away before asking for a name, so the player sees the end first. */
const ENTRY_DELAY_MS = 900;

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const REFUSALS: Readonly<Record<string, string>> = {
  'not-verified': "This roll couldn't be checked, so it can't go on the world table.",
  'too-long': 'This roll ran too long to count.',
  'not-possible': "This roll couldn't be counted.",
  'not-top': `Only the top ${LEADERBOARD_SIZE} rolls go on the leaderboard, and this one did not make it.`,
  busy: 'Too many scores from here just now. Try again a little later.',
  offline: "Can't reach the table, so this roll can't go on it.",
  challenge: "Couldn't check that you're a person. Try again.",
  debug: 'Rolls with the debug keys do not go on the table.',
};

export class HighScores {
  readonly session: RunSession;
  readonly entry: NameEntry;
  readonly board = new Scoreboard();
  /** The line under the worn-away card: whether this roll can be signed. */
  onNote: (text: string) => void = () => {};
  /** Called whenever a screen of this kind opens or closes, so the game can pause and the keys can be held back. */
  onModal: (open: boolean) => void = () => {};
  private signing = false;
  private pending: ReturnType<typeof setTimeout> | null = null;
  /** Counts runs, so an answer that arrives after a new run has started is ignored. */
  private run = 0;

  constructor(distance: () => number, letters: LetterStage, camera: THREE.PerspectiveCamera) {
    this.session = new RunSession(distance);
    this.entry = new NameEntry(letters, camera);
    this.board.onClose = () => this.onModal(false);
  }

  get open(): boolean { return this.entry.isOpen || this.board.isOpen; }

  /** A new run begins. */
  runStarted() {
    if (this.pending) { clearTimeout(this.pending); this.pending = null; }
    const wasOpen = this.open;
    if (this.entry.isOpen) this.entry.close();
    if (this.board.isOpen) this.board.hide();
    if (wasOpen) this.onModal(false);
    this.signing = false;
    this.run++;
    this.onNote('');
    this.session.start();
  }

  /** Game over, with `distance` metres. Ask the server whether this roll earns a place on the leaderboard; only then ask for a name. */
  runEnded(distance: number) {
    this.session.finish();
    if (this.signing) return;
    this.signing = true;
    const run = this.run;
    void this.session.qualify(distance).then(result => {
      if (run !== this.run) return;
      if (!result.qualifies) {
        const reason = result.reason === 'not-top' && result.rank
          ? `This roll would be ${ordinal(result.rank)}. Only the top ${LEADERBOARD_SIZE} go on the leaderboard.`
          : REFUSALS[result.reason] ?? REFUSALS['not-verified'];
        this.onNote(reason); this.signing = false; return;
      }
      this.onNote(`This roll is ${ordinal(result.rank)}: a place on the leaderboard!`);
      this.pending = setTimeout(() => { this.pending = null; void this.sign(distance, result.rank); }, ENTRY_DELAY_MS);
    });
  }

  showTable() {
    if (this.entry.isOpen) return;
    this.onModal(true);
    void this.board.show();
  }

  private async sign(distance: number, rank: number) {
    this.onModal(true);
    let result = await this.entry.open(distance, rank);
    let challenge: string | undefined;
    for (;;) {
      if (result.kind === 'skipped') { this.entry.close(); this.onModal(false); this.onNote('Not signed, so it is not on the table.'); this.signing = false; return; }
      this.entry.holdFor('Sending…');
      const outcome: SubmitResult = await this.session.submit(result.name, distance, challenge);
      if (outcome.accepted) {
        this.entry.close();
        this.onNote('');
        await this.board.show({ mineId: outcome.id, distance });
        this.signing = false;
        return;
      }
      if (outcome.reason === 'bad-name') { result = await this.entry.reopen("That name can't go on the table. Try another."); continue; }
      if (outcome.reason === 'challenge') {
        this.entry.holdFor('One moment: checking that you are a person…');
        const token = await solveChallenge(this.entry.challengeTarget);
        if (token) { challenge = token; result = { kind: 'signed', name: result.name }; continue; }
      }
      this.entry.close();
      this.onNote(REFUSALS[outcome.reason] ?? REFUSALS['not-verified']);
      await this.board.show({ distance, note: REFUSALS[outcome.reason] ?? REFUSALS['not-verified'] });
      this.signing = false;
      return;
    }
  }
}
