# Speaking another language

A plan for making the app render in Dutch, and in whatever comes after Dutch.

Written 2026-09-08, in the same shape as [voice-plan.md](voice-plan.md) and
[vault-plan.md](vault-plan.md): what is being decided, what is honestly hard,
and what order it gets built in.

## The size of it, stated first

Every other feature in this repo has been a new file or two and a section in
Settings. This one is not. There are around 44 components carrying roughly 450
pieces of user-visible English, and every one of them has to move out of the
component and into a catalogue before a single word of Dutch is worth writing.
That is the work. The Dutch itself is the easy half.

Two consequences worth knowing before starting:

- **It touches nearly every file in `client/src`.** That is the largest merge
  surface any change in this project has had. Backend work will not collide
  with it, but anything else in the client will.
- **There is no useful half.** An app that is Dutch in Settings and English in
  the composer reads as broken, not as in progress. Either a locale covers the
  app or it should not be offered.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| A library? | No. About 120 lines of our own. | The client has three runtime dependencies. `Intl.PluralRules` and `Intl.DateTimeFormat` are in the browser already, and what is left is a lookup and a `{name}` substitution. |
| Keys or English source? | Dotted keys, `vault.setup.title`. | The prose here is long and it is part of the design. `t('...')` holding three sentences of copy makes the component unreadable, and the catalogue doubles as the one place the whole app's voice can be reviewed. |
| Where does English live? | `lib/i18n/en.ts`, as the source of truth. | It is a normal TypeScript object, so `keyof typeof en` types `t()` and `tsc` refuses a key that does not exist. No runtime key checking needed. |
| Missing translations? | Fall back to English, silently. | A missing string should degrade, not crash. A test asserts the count of missing ones is zero, so falling back is a safety net rather than a habit. |
| Plurals | `{ one, other }` and `Intl.PluralRules`. | Both English and Dutch have exactly these two forms. The shape is general enough for a language that has more. |
| Does the server learn your language? | No. | Same rule as every other preference: `settings` is device-local, and an app whose claim is that the server cannot read your messages should not be telling it what language you read them in. |
| Dates and times | Formatted through the chosen locale, not the OS one. | Picking Dutch and still getting `1:22 AM` is a half-finished translation. |
| Right to left | Not now, but the seam carries `dir`. | Arabic and Hebrew are a layout problem, not a translation problem, and pretending otherwise would mean rebuilding this later. Every locale we ship is `ltr`; the attribute is written anyway so that the day one is not, the work is CSS and not plumbing. |

## The honest part

Machine translating this app would produce something technically correct and
tonally wrong. The English here has a voice: it is plain, it refuses to
over-claim about encryption, and it says things like *about 1 million
combinations* rather than drawing a padlock. A translation that loses that
loses the thing the copy was for.

Two specific traps:

- **The security copy.** "Sealed", "wrapped", "locked" and "encrypted" are used
  precisely and differently in this app. Dutch has *versleuteld*, *vergrendeld*
  and *verzegeld*, and mapping them carelessly would make the UI claim more
  than it can back, which is the one thing STATUS.md decision 21 forbids.
- **The writing style rules are English rules.** No em dashes and no Oxford
  commas are house style for this repo's English. Dutch punctuation has its own
  conventions, and following the English ones into Dutch would just be wrong.
  The rule that carries over is the intent: plain, unfussy, no decoration.

## Stages

**Stage 1: the seam, and Dutch.**
`lib/i18n/` with the catalogue, `t()`, plural selection and the locale-aware
date and time helpers. A `language` setting, an `I18nProvider`, `<html lang>`
and `dir` written alongside the theme attributes. First run guesses from
`navigator.language` and is overridable forever after. Then the sweep, and then
`nl.ts`.

### Stage 1 is done, 2026-09-08

The sweep finished. Every screen in the client reads from the catalogue, and
`nl.ts` answers every key in `en.ts`.

Four checks hold it together, and between them they are why this was
survivable at all:

- **`tsc`** refuses a key that does not exist and refuses a translation that
  invents one, because `Key` is derived from `en.ts` itself.
- **A coverage test** names any English entry Dutch has not answered, rather
  than counting them.
- **A placeholder test** catches a translation that dropped a `{name}` and
  would render a sentence with a hole in it.
- **An orphan test** walks the source for keys nothing asks for any more. It
  found four on the first run, which is exactly the rot it exists to catch.

Two things that are deliberately *not* translated, and are worth restating
because both look like gaps:

- **Palette names.** "Ember" and "Tide" are names the way a paint chart has
  names. The swatch does the explaining.
- **Sentences the server wrote.** The API answers with prose, not codes, so
  there is nothing to look up, and inventing a translation for a sentence we
  did not write would mean guessing at what it said. Where the server does
  answer with a code, as the friend-request endpoints do, the app decides what
  it means in words and that *is* translated.

Failures the app names itself carry a `Phrase` alongside their English
`message`: the message is what lands in a stack trace, the phrase is what a
person reads. `describeError` in `state/I18nProvider.tsx` is the one place
that rule lives.

**Stage 2: whatever language is asked for next.**
Additive by then, and the size of one file. This is the whole reason stage 1 is
worth the size it is.

**Not planned: translating content.**
Messages, nicknames, profile text and vault notes are what a person wrote. They
are shown as they were written, and no locale touches them.
