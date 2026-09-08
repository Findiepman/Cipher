/**
 * Errors that know how to say themselves in any language.
 *
 * The app throws two kinds of failure at a screen. One arrives from the server
 * as a sentence somebody else wrote, and there is nothing to look up: it is
 * shown as it came. The other is ours, thrown by a module under `lib/` that
 * has no `t` of its own, and that one can carry a catalogue key alongside its
 * English `message`.
 *
 * `message` is kept English on purpose even where a phrase exists. It is what
 * lands in a stack trace and in a console, and a log in a language the reader
 * does not have is worse than no log.
 */
import type { Key } from './en';
import type { Phrase } from './translate';

/** Implemented by any error that has a catalogue entry describing it. */
export interface Translatable {
  readonly phrase: Phrase<Key>;
}

/** The phrase on an error, if it has one. */
export function phraseOf(value: unknown): Phrase<Key> | null {
  if (typeof value !== 'object' || value === null) return null;
  const phrase = (value as Partial<Translatable>).phrase;
  return phrase && typeof phrase.key === 'string' ? phrase : null;
}
