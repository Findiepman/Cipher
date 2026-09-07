/**
 * The username word filter.
 *
 * A username is the one handle this app hands out: it is how people find each
 * other, it sits beside every message, and it cannot be changed today. So it is
 * worth refusing a small set of them at the door.
 *
 * This lives on the server and only on the server, deliberately. A copy in the
 * client would give instant feedback, but it would also ship the list to every
 * visitor, which is both a document nobody wants to read and a map of exactly
 * what to work around. The client shows the rejection the server sends back.
 *
 * Two lists, because one rule cannot cover both cases:
 *
 *   SUBSTRING  terms that are unambiguous wherever they appear. Matching these
 *              anywhere in the handle is the point, since "xX_<slur>_Xx" is the
 *              usual shape.
 *   WHOLE      short or ordinary words that also live inside innocent ones.
 *              "pedo" is inside "torpedo", "rapist" inside "therapist", "paki"
 *              inside "pakistani". These are refused only when the whole handle
 *              reduces to them. That is the Scunthorpe problem, and it is the
 *              only reason there are two lists rather than one.
 *
 * Both sides of every comparison go through the same normalizer, so "n1gg3r",
 * "n.i.g.g.e.r" and "nííígger" collapse onto the same string as the list entry.
 * It will not catch everything and it is not trying to: it raises the cost of
 * an obvious handle, and a human still has to be able to report the rest.
 */

/// Confusables mapped back to the letter they imitate. Only characters people
/// actually substitute; a general Unicode confusables table would be a large
/// dependency for a small gain.
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
  '(': 'c',
  '<': 'c',
};

/**
 * Everything that is not a letter falls away, so separators, repeats and
 * decoration cannot be used to break a word up.
 */
export function normalizeHandle(input: string): string {
  const folded = input
    .normalize('NFKD')
    // Strip the combining marks NFKD just split off, so "é" is "e" and a name
    // buried under stacked diacritics is still the name.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  let out = '';
  for (const character of folded) {
    const mapped = LOOKALIKES[character] ?? character;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

/// Runs of one letter collapsed to a single one, so "niiiggerrr" reduces to the
/// same string the list entry does. Applied to both sides or it would be
/// comparing two different alphabets.
function squeeze(normalized: string): string {
  let out = '';
  for (const character of normalized) {
    if (character !== out[out.length - 1]) out += character;
  }
  return out;
}

/**
 * A squeezed term is only used for substring matching once it is this long.
 *
 * Squeezing shortens a term, and a short enough one matches everything: "kkk"
 * squeezes to "k", which would refuse every handle with a k in it. The flat
 * form of those terms is still matched, so nothing is lost except the ability
 * to see through padded repeats on very short words.
 */
const SQUEEZED_SUBSTRING_MIN = 4;

/// Matched anywhere in the handle.
const SUBSTRING_TERMS = [
  // Slurs.
  'nigger',
  'nigga',
  'faggot',
  'tranny',
  'shemale',
  'chink',
  'gook',
  'wetback',
  'towelhead',
  'raghead',
  'kike',
  'dago',
  'gypsy',
  'jigaboo',
  'darkie',
  'beaner',
  'redskin',
  'zipperhead',
  'mongoloid',
  'retard',
  'cripple',
  'midget',
  // Hate signals.
  'hitler',
  'heilhitler',
  'nazi',
  'gaschamber',
  'holocaust',
  'kkk',
  'whitepower',
  'whitepride',
  // Sexual content involving minors. Never a legitimate handle.
  'childporn',
  'childrape',
  'pedophile',
  'paedophile',
  'lolicon',
  'jailbait',
  // Strong profanity, long enough not to hide inside an ordinary word.
  'fuck',
  'shit',
  'bitch',
  'bastard',
  'whore',
  'slut',
  'cunt',
  'wanker',
  'motherfucker',
  'asshole',
  'dickhead',
  'bollocks',
  'blowjob',
  'handjob',
  'creampie',
  'gangbang',
  'bukkake',
  'hentai',
  'porn',
  'xvideos',
  'masturbat',
  'ejaculat',
  'testicle',
  'clitoris',
  'vagina',
  'scrotum',
  'buttplug',
  'dildo',
  'fleshlight',
  // Violence directed at a person.
  'killyourself',
  'killurself',
];

/**
 * Refused only when the entire handle reduces to one of these.
 *
 * Every entry here lives inside at least one ordinary word or name, so
 * substring matching them would refuse people who have done nothing:
 * "therapist", "torpedo", "pakistani", "raccoon", "mustard", "suspicious",
 * "lollipop", "connor".
 */
const WHOLE_TERMS = [
  'ass',
  'arse',
  'anal',
  'anus',
  'butt',
  'boob',
  'tit',
  'tits',
  'titty',
  'cock',
  'dick',
  'penis',
  'cum',
  'jizz',
  'semen',
  'sperm',
  'piss',
  'crap',
  'turd',
  'fart',
  'twat',
  'prick',
  'knob',
  'schlong',
  'queer',
  'homo',
  'dyke',
  'fag',
  'jap',
  'paki',
  'spic',
  'coon',
  'wop',
  'negro',
  'tard',
  'kill',
  'rape',
  'rapist',
  'pedo',
  'paedo',
  'loli',
  'shota',
  'cp',
  'nude',
  'nudes',
  'sex',
  'sexy',
  'orgy',
  'milf',
  'incest',
  'bdsm',
  'nsfw',
  'suicide',
];

/**
 * Names that would let a handle pass for part of the service.
 *
 * This one is not about profanity. Adding a friend is by exact username and
 * nothing else, so a handle like "support" is a working phishing hook: someone
 * told to "add cipher-support" has no directory to check it against. Whole
 * matches only, so "supporter" is still free.
 */
const RESERVED_TERMS = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'staff',
  'support',
  'help',
  'helpdesk',
  'system',
  'root',
  'official',
  'security',
  'billing',
  'cipher',
  'cipherteam',
  'ciphersupport',
  'noreply',
  'everyone',
  'here',
  'null',
  'undefined',
];

interface Prepared {
  flat: string;
  squeezed: string;
}

function prepare(terms: string[]): Prepared[] {
  return terms.map((term) => {
    const flat = normalizeHandle(term);
    return { flat, squeezed: squeeze(flat) };
  });
}

const SUBSTRING = prepare(SUBSTRING_TERMS);
const WHOLE = prepare(WHOLE_TERMS);
const RESERVED = prepare(RESERVED_TERMS);

export type UsernameRejection = 'offensive' | 'reserved';

/**
 * Null when the handle is fine.
 *
 * Callers turn the reason into a message. The two cases read very differently
 * to whoever is signing up, and collapsing them would tell someone their name
 * is a slur when it is really just "admin".
 */
export function screenUsername(username: string): UsernameRejection | null {
  const flat = normalizeHandle(username);
  // Nothing but decoration. Not offensive, but not a handle either, and the
  // format rule in schemas.ts cannot see it because it reads the raw string.
  if (flat.length === 0) return 'offensive';

  const squeezed = squeeze(flat);

  for (const term of SUBSTRING) {
    if (flat.includes(term.flat)) return 'offensive';
    if (
      term.squeezed.length >= SQUEEZED_SUBSTRING_MIN &&
      squeezed.includes(term.squeezed)
    ) {
      return 'offensive';
    }
  }

  for (const term of WHOLE) {
    if (flat === term.flat || squeezed === term.squeezed) return 'offensive';
  }

  for (const term of RESERVED) {
    if (flat === term.flat || squeezed === term.squeezed) return 'reserved';
  }

  return null;
}

export function usernameRejectionMessage(reason: UsernameRejection): string {
  return reason === 'reserved'
    ? 'That username is reserved. Please pick another one.'
    : 'That username is not available. Please pick another one.';
}
