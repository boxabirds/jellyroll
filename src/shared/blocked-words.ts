/**
 * A starting list of words kept off the table: common profanity and hate terms. It is a list, not a promise;
 * the owner removes anything that gets past it with the removal route.
 */
export const BLOCKED_WORDS: readonly string[] = [
  'FUCK', 'SHIT', 'CUNT', 'DICK', 'COCK', 'PISS', 'BITCH', 'WHORE', 'SLUT', 'TWAT', 'WANK', 'BOLLOCK', 'PRICK',
  'NAZI', 'RAPE', 'RAPIST', 'NIGGER', 'NIGGA', 'FAGGOT', 'RETARD', 'KIKE', 'SPIC', 'CHINK', 'PAKI', 'TRANNY',
  'PORN', 'PENIS', 'VAGINA', 'TITS', 'BOOBS', 'JIZZ', 'HITLER',
];

/** Innocent words that contain a blocked one, removed before the check. */
export const ALLOWED_WORDS: readonly string[] = [
  'PEACOCK', 'COCKPIT', 'COCKATOO', 'COCKLE', 'COCKNEY', 'SHIITAKE', 'SHITAKE', 'DICKENS', 'DICKINSON', 'PRICKLE',
  'PRICKLY', 'SPICE', 'SPICY', 'RAPESEED', 'GRAPE', 'DRAPE', 'TRAPEZE', 'PAKISTAN',
];
