import type { Key } from '../i18n/en';

/**
 * Every sound the app makes, synthesised on the fly rather than shipped as
 * audio files.
 *
 * Two reasons it is written this way. The boring one is weight: a ringtone
 * that loops for thirty seconds is a few hundred kilobytes as an .ogg and
 * about forty lines as a score. The better one is that a sample is opaque:
 * "make the ding a bit softer" means finding whoever owns the .wav, while here
 * it means changing a number in a preset below.
 *
 * The palette is Minecraft's note block, which suits this app for a reason
 * beyond taste: note block tones are short, clean and pitched, so they carry
 * across a room without the startle a broadband alert tone has. The
 * instruments are approximations, not rips. `harp` and `bell` are additive
 * stacks tuned by ear against the originals, so no sampled game audio ends up
 * in the bundle.
 *
 * Scores are synthesised, then rendered to a WAV and played through an
 * `<audio>` element rather than scheduled live. That detail is load bearing on
 * a phone: Web Audio goes out on the ringer channel, which an iPhone's side
 * switch mutes, and an element goes out on the media channel, which it does
 * not. See the engine section below.
 *
 * Browsers also refuse to play anything until the page has been interacted
 * with, so `unlock()` exists for the app to call from an early click. Every
 * failure here is silent: a messenger that throws because it could not play a
 * ding is worse than a quiet one.
 */

/* ------------------------------------------------------------------ notes */

const SEMITONES: Record<string, number> = {
  C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4,
  'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2,
};

/** `note('F#5')` gives 739.99. A4 = 440Hz, equal temperament. */
export function note(name: string): number {
  const match = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`not a note name: ${name}`);
  const [, pitch, octave] = match;
  const steps = SEMITONES[pitch] + (Number(octave) - 4) * 12;
  return 440 * Math.pow(2, steps / 12);
}

/* -------------------------------------------------------------- instruments */

interface Partial {
  /** Multiple of the fundamental. Non-integers are what make metal sound like metal. */
  ratio: number;
  gain: number;
  type: OscillatorType;
  /** Partials that die faster than the fundamental are what make a struck thing sound struck. */
  decay?: number;
}

interface Instrument {
  partials: Partial[];
  /** Seconds to full volume. Under ~3ms you hear a click, which is sometimes the point. */
  attack: number;
  /** Seconds for the fundamental to fall away to silence. */
  decay: number;
  /** Lowpass cutoff as a multiple of the fundamental. Keeps the top end from turning glassy. */
  brightness: number;
}

export type Timbre = 'harp' | 'bell' | 'chime' | 'pling' | 'bass' | 'wood';

const INSTRUMENTS: Record<Timbre, Instrument> = {
  /* The default note block. Nearly a sine, with just enough second and third
   * harmonic to stop it sounding like a hearing test. */
  harp: {
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 2, gain: 0.16, type: 'sine', decay: 0.5 },
      { ratio: 3, gain: 0.05, type: 'triangle', decay: 0.3 },
    ],
    attack: 0.004,
    decay: 0.9,
    brightness: 8,
  },
  /* Inharmonic partials and a long ring: the ratios below are roughly a
   * tubular bell's, which is why it reads as metal rather than as a loud harp. */
  bell: {
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 2.76, gain: 0.4, type: 'sine', decay: 0.7 },
      { ratio: 5.4, gain: 0.16, type: 'sine', decay: 0.4 },
      { ratio: 8.93, gain: 0.07, type: 'sine', decay: 0.2 },
    ],
    attack: 0.002,
    decay: 2.2,
    brightness: 12,
  },
  /* Soft, breathy, no strike. The one that can repeat without wearing thin. */
  chime: {
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 3, gain: 0.12, type: 'sine', decay: 0.6 },
      { ratio: 5, gain: 0.04, type: 'sine', decay: 0.35 },
    ],
    attack: 0.03,
    decay: 1.4,
    brightness: 6,
  },
  /* Square-ish and synthetic: the game-menu end of the palette. */
  pling: {
    partials: [
      { ratio: 1, gain: 0.7, type: 'square' },
      { ratio: 2, gain: 0.25, type: 'sine' },
    ],
    attack: 0.002,
    decay: 0.32,
    brightness: 5,
  },
  /* A struck block: almost all attack, gone in a sixth of a second. The one
   * voice here with no pitch worth hearing, which is what makes it read as a
   * knock rather than as a note. */
  wood: {
    partials: [
      { ratio: 1, gain: 1, type: 'triangle' },
      { ratio: 2.41, gain: 0.34, type: 'square', decay: 0.35 },
      { ratio: 4.7, gain: 0.12, type: 'square', decay: 0.2 },
    ],
    attack: 0.001,
    decay: 0.17,
    brightness: 3.5,
  },
  /* Low and round, for the floor under a ring pattern. */
  bass: {
    partials: [
      { ratio: 1, gain: 1, type: 'sine' },
      { ratio: 2, gain: 0.1, type: 'triangle', decay: 0.4 },
    ],
    attack: 0.006,
    decay: 0.7,
    brightness: 4,
  },
};

/* ------------------------------------------------------------------ scores */

interface Beat {
  /** Note name, or a raw frequency for anything off the grid. */
  pitch: string | number;
  /** Seconds from the start of the pattern. */
  at: number;
  timbre?: Timbre;
  gain?: number;
  /** Overrides the instrument's own decay, in seconds. */
  decay?: number;
}

export interface Pattern {
  /**
   * Catalogue key for the name shown in the picker. A key rather than a word
   * because these are heard, not read: "Village bells" tells a Dutch reader
   * nothing that "Kerkklokken" would not tell them better, and this module
   * has no language of its own.
   */
  label: Key;
  /** One line on what it is going for. */
  note: string;
  beats: Beat[];
  /** For ringtones: seconds from one repeat to the next, silence included. */
  period?: number;
}

/**
 * Message alerts. All of them land inside half a second, because an alert
 * longer than that is a jingle and you will hate it by Tuesday.
 */
export const MESSAGE_SOUNDS = {
  /* One note block, struck once. The least you can do, and hard to tire of. */
  ding: {
    label: 'sound.ding',
    note: 'A single note block harp note.',
    beats: [{ pitch: 'F#5', at: 0 }],
  },
  /* Two notes up a fifth: the shape of the XP orb pickup, minus the clatter. */
  orb: {
    label: 'sound.orb',
    note: 'Two harp notes rising a fifth, like picking up experience.',
    beats: [
      { pitch: 'C#5', at: 0, decay: 0.45 },
      { pitch: 'G#5', at: 0.075 },
    ],
  },
  /* A real metal strike. Carries across a room, and is a little more insistent. */
  bell: {
    label: 'sound.bell',
    note: 'One bell-block strike, bright and long-ringing.',
    beats: [{ pitch: 'F#5', at: 0, timbre: 'bell', gain: 0.8 }],
  },
  /* Squarewave blip, straight out of a menu. Playful, least "notification". */
  blip: {
    label: 'sound.blip',
    note: 'Two square-wave clicks, the game-menu end of the palette.',
    beats: [
      { pitch: 'F#5', at: 0, timbre: 'pling' },
      { pitch: 'C#6', at: 0.06, timbre: 'pling', gain: 0.7 },
    ],
  },
  /* Two wooden taps. The quietest way to say something happened, and the
   * only one here that does not ring, so it cuts through a room of chimes. */
  knock: {
    label: 'sound.knock',
    note: 'Two soft wooden taps. Carries without ringing.',
    beats: [
      { pitch: 'D3', at: 0, timbre: 'wood' },
      { pitch: 'A2', at: 0.085, timbre: 'wood', gain: 0.8 },
    ],
  },
  /* A single high tap on metal. Very short, very bright, easy to place. */
  glass: {
    label: 'sound.glass',
    note: 'One bright tap, high and quick.',
    beats: [{ pitch: 'D6', at: 0, timbre: 'bell', gain: 0.45, decay: 0.9 }],
  },
  /* For someone who wants to be told, not alerted. */
  hush: {
    label: 'sound.hush',
    note: 'A low, soft chime. The gentlest of the set.',
    beats: [{ pitch: 'A4', at: 0, timbre: 'chime', gain: 0.42, decay: 1.2 }],
  },
  /* Three-note major arpeggio: friendliest of the set, and the longest. */
  chirp: {
    label: 'sound.chirp',
    note: 'A three-note rising arpeggio. Warm, a touch celebratory.',
    beats: [
      { pitch: 'D5', at: 0, decay: 0.35 },
      { pitch: 'F#5', at: 0.07, decay: 0.35 },
      { pitch: 'A5', at: 0.14 },
    ],
  },
} satisfies Record<string, Pattern>;

/**
 * Ring patterns. These repeat until answered, which changes the design problem
 * completely: the test is not "is it nice" but "is it still bearable on the
 * ninth repeat", so every one of them leaves a long silence in the period
 * rather than filling it.
 */
export const RING_SOUNDS = {
  /* Rising arpeggio, twice per cycle. The obvious Minecraft answer. */
  arpeggio: {
    label: 'sound.arpeggio',
    note: 'A note-block arpeggio climbing twice, then silence.',
    period: 3,
    beats: [
      { pitch: 'D5', at: 0.0, decay: 0.3 },
      { pitch: 'F#5', at: 0.12, decay: 0.3 },
      { pitch: 'A5', at: 0.24, decay: 0.3 },
      { pitch: 'D6', at: 0.36, decay: 0.6 },
      { pitch: 'D5', at: 0.7, decay: 0.3, gain: 0.85 },
      { pitch: 'F#5', at: 0.82, decay: 0.3, gain: 0.85 },
      { pitch: 'A5', at: 0.94, decay: 0.3, gain: 0.85 },
      { pitch: 'D6', at: 1.06, decay: 0.9, gain: 0.85 },
    ],
  },
  /* Two bell strikes spaced like a landline's double ring. Reads as "phone"
   * before it reads as "game", which for an incoming call is the right way
   * round. */
  bells: {
    label: 'sound.villageBells',
    note: 'Two bell strikes per ring, spaced like an old telephone.',
    period: 4,
    beats: [
      { pitch: 'A4', at: 0, timbre: 'bell', gain: 0.75 },
      { pitch: 'E5', at: 0.09, timbre: 'bell', gain: 0.5 },
      { pitch: 'A4', at: 0.85, timbre: 'bell', gain: 0.7 },
      { pitch: 'E5', at: 0.94, timbre: 'bell', gain: 0.45 },
    ],
  },
  /* A held low note with a chime floating over it: the cave-ambience end of
   * the game. Quietest of the four, and the one for a desk at night. */
  hollow: {
    label: 'sound.hollow',
    note: 'A low sustained tone under a soft high chime. Understated.',
    period: 4.5,
    beats: [
      { pitch: 'D3', at: 0, timbre: 'bass', decay: 1.8, gain: 0.5 },
      { pitch: 'A4', at: 0.25, timbre: 'chime', gain: 0.45 },
      { pitch: 'D5', at: 0.95, timbre: 'chime', gain: 0.35, decay: 2 },
    ],
  },
  /* Wooden ticks in pairs. No pitch to speak of, so it sits in a completely
   * different part of the ear from the bells and the harp, which is exactly
   * what you want when two people can be ringing you. */
  clock: {
    label: 'sound.clock',
    note: 'Wooden ticks in pairs, like a wind-up alarm.',
    period: 2.6,
    beats: [
      { pitch: 'C5', at: 0, timbre: 'wood' },
      { pitch: 'G4', at: 0.26, timbre: 'wood', gain: 0.85 },
      { pitch: 'C5', at: 0.86, timbre: 'wood' },
      { pitch: 'G4', at: 1.12, timbre: 'wood', gain: 0.85 },
    ],
  },
  /* Soft, slow and unhurried. For the person you are always glad to hear from. */
  ripple: {
    label: 'sound.ripple',
    note: 'Three chimes drifting upward. Calm, and easy to ignore.',
    period: 4.2,
    beats: [
      { pitch: 'A4', at: 0, timbre: 'chime', gain: 0.5 },
      { pitch: 'D5', at: 0.42, timbre: 'chime', gain: 0.45 },
      { pitch: 'F#5', at: 0.84, timbre: 'chime', gain: 0.4, decay: 2 },
    ],
  },
  /* Somebody at the door. Two knocks, a pause, two more. */
  door: {
    label: 'sound.door',
    note: 'A wooden double knock, twice. Unmistakably someone wanting you.',
    period: 3.4,
    beats: [
      { pitch: 'A2', at: 0, timbre: 'wood' },
      { pitch: 'A2', at: 0.21, timbre: 'wood', gain: 0.9 },
      { pitch: 'A2', at: 0.62, timbre: 'wood' },
      { pitch: 'A2', at: 0.83, timbre: 'wood', gain: 0.9 },
    ],
  },
  /* Four-note call and answer, the busiest option. Hardest to sleep through,
   * which is either the point or the problem. */
  fanfare: {
    label: 'sound.fanfare',
    note: 'A four-note call and answer. The one you will not miss.',
    period: 3.2,
    beats: [
      { pitch: 'A4', at: 0, decay: 0.25 },
      { pitch: 'D5', at: 0.11, decay: 0.25 },
      { pitch: 'F#5', at: 0.22, decay: 0.25 },
      { pitch: 'A5', at: 0.33, decay: 0.7 },
      { pitch: 'G5', at: 0.75, decay: 0.25, gain: 0.8 },
      { pitch: 'E5', at: 0.86, decay: 0.25, gain: 0.8 },
      { pitch: 'D5', at: 0.97, decay: 1, gain: 0.8 },
    ],
  },
} satisfies Record<string, Pattern>;

/**
 * The sounds a call makes at the caller's end: the tone while the far device
 * rings, and the two blips that bracket a connected call. These are
 * deliberately plainer than the ringtones: you are listening past them for a
 * voice.
 */
export const CALL_SOUNDS = {
  /** What the caller hears while the other device is ringing. */
  dialing: {
    label: 'sound.ringback',
    note: 'A soft two-note pulse while the far end rings.',
    period: 3,
    beats: [
      { pitch: 'D5', at: 0, timbre: 'chime', gain: 0.3, decay: 0.5 },
      { pitch: 'A4', at: 0.3, timbre: 'chime', gain: 0.25, decay: 0.7 },
    ],
  },
  /** The far end picked up. Rising, short, gets out of the way. */
  connected: {
    label: 'sound.connected',
    note: 'Two quick rising notes when the call opens.',
    beats: [
      { pitch: 'A4', at: 0, decay: 0.2 },
      { pitch: 'E5', at: 0.07, decay: 0.4 },
    ],
  },
  /** The call ended. The same two notes, falling. */
  ended: {
    label: 'sound.hungUp',
    note: 'The connect tone in reverse.',
    beats: [
      { pitch: 'E5', at: 0, decay: 0.2 },
      { pitch: 'A4', at: 0.07, decay: 0.5 },
    ],
  },
} satisfies Record<string, Pattern>;

export type MessageSound = keyof typeof MESSAGE_SOUNDS;
export type RingSound = keyof typeof RING_SOUNDS;

/**
 * The two catalogues, in the order a picker should list them.
 *
 * Declaration order is the order, so adding a preset above puts it in the
 * settings screen with no second list to keep in step.
 */
export const MESSAGE_SOUND_IDS = Object.keys(MESSAGE_SOUNDS) as MessageSound[];
export const RING_SOUND_IDS = Object.keys(RING_SOUNDS) as RingSound[];

export const DEFAULT_MESSAGE_SOUND: MessageSound = 'ding';
export const DEFAULT_RING_SOUND: RingSound = 'bells';

/**
 * Settings are merged over defaults rather than validated, so a stored blob can
 * name a preset that a later build renamed or dropped. These two turn that into
 * the default instead of into silence, which is the failure people report as
 * "notifications stopped working".
 */
export function asMessageSound(id: unknown): MessageSound {
  return typeof id === 'string' && id in MESSAGE_SOUNDS
    ? (id as MessageSound)
    : DEFAULT_MESSAGE_SOUND;
}

export function asRingSound(id: unknown): RingSound {
  return typeof id === 'string' && id in RING_SOUNDS ? (id as RingSound) : DEFAULT_RING_SOUND;
}

/* ------------------------------------------------------------------ engine */

/**
 * Why the scores are rendered rather than played live.
 *
 * The obvious way to do this is to schedule oscillators on a live
 * AudioContext. It works everywhere except the one place a messenger's
 * notification sound matters most: an iPhone with the side switch on silent.
 * Web Audio goes out on the ringer channel there, which that switch mutes,
 * and no amount of `resume()` changes it. An `<audio>` element goes out on the
 * media channel, the one a video uses, which the switch does not touch.
 *
 * So each score is rendered once through an OfflineAudioContext into a WAV,
 * kept as an object URL and handed to an element. The synthesis is identical.
 * A ring is rendered exactly one period long so the element can loop it with
 * no gap, which also removes the scheduling loop the live version needed.
 */

/** Enough for the highest partial here (a bell's 8.93x on a 740Hz note). */
const RATE = 32000;

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.OfflineAudioContext ??
    (window as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext ??
    null
  );
}

/** Schedules one struck note. Everything audible in this file goes through here. */
function strike(ctx: BaseAudioContext, master: GainNode, beat: Beat, when: number): void {
  const inst = INSTRUMENTS[beat.timbre ?? 'harp'];
  const freq = typeof beat.pitch === 'number' ? beat.pitch : note(beat.pitch);
  const decay = beat.decay ?? inst.decay;
  const level = (beat.gain ?? 1) * 0.28; // Headroom for chords; stacked partials add up fast.

  const shape = ctx.createBiquadFilter();
  shape.type = 'lowpass';
  shape.frequency.value = Math.min(freq * inst.brightness, 15000);
  shape.connect(master);

  for (const partial of inst.partials) {
    const osc = ctx.createOscillator();
    osc.type = partial.type;
    osc.frequency.value = freq * partial.ratio;

    const env = ctx.createGain();
    const peak = level * partial.gain;
    const life = decay * (partial.decay ?? 1);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(peak, when + inst.attack);
    // Exponential, not linear: a linear fade sounds like someone turning a
    // knob down, an exponential one sounds like something that was hit.
    env.gain.exponentialRampToValueAtTime(0.0001, when + inst.attack + life);

    osc.connect(env);
    env.connect(shape);
    osc.start(when);
    osc.stop(when + inst.attack + life + 0.02);
  }
}

/** How long a pattern rings for, counting the tail of its last note. */
function tailOf(pattern: Pattern): number {
  return Math.max(
    ...pattern.beats.map((beat) => {
      const inst = INSTRUMENTS[beat.timbre ?? 'harp'];
      return beat.at + (beat.decay ?? inst.decay);
    }),
  );
}

/** 16-bit mono PCM. The smallest container every browser will play. */
function toWav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  put(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let at = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    at += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Rendered scores, by cache key. A pattern is only ever synthesised once. */
const rendered = new Map<string, Promise<string | null>>();

function urlFor(key: string, pattern: Pattern, looping: boolean): Promise<string | null> {
  const existing = rendered.get(key);
  if (existing) return existing;

  const job = (async () => {
    const Ctor = offlineCtor();
    if (!Ctor) return null;

    // A loop is exactly one period so it repeats seamlessly. Every ring pattern
    // here finishes its last note inside its own period, so nothing is clipped.
    const seconds = looping ? (pattern.period ?? 3) : tailOf(pattern) + 0.25;

    try {
      const ctx = new Ctor(1, Math.ceil(seconds * RATE), RATE);
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      for (const beat of pattern.beats) strike(ctx, master, beat, beat.at + 0.004);
      return URL.createObjectURL(toWav(await ctx.startRendering()));
    } catch {
      return null; // No audio hardware, or a browser without offline rendering.
    }
  })();

  rendered.set(key, job);
  return job;
}

/* ------------------------------------------------------------- playback */

let volume = 1;
let sinkId: string | null = null;
let oneShot: HTMLAudioElement | null = null;
let looper: HTMLAudioElement | null = null;

function element(loop: boolean): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const existing = loop ? looper : oneShot;
  if (existing) return existing;

  const audio = new Audio();
  audio.loop = loop;
  audio.volume = volume;
  // Never let an alert take over a phone's lock screen or media buttons.
  audio.preload = 'auto';
  if (loop) looper = audio;
  else oneShot = audio;
  return audio;
}

/**
 * Call once from any early user gesture, such as a click on the unlock screen.
 *
 * Phones refuse to play audio until the page has been interacted with. Playing
 * a silent frame inside a real gesture is what buys the right to make a sound
 * later, when a call arrives and there is no gesture to hand.
 */
export function unlock(): void {
  const audio = element(false);
  if (!audio) return;
  audio.muted = true;
  void audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
    })
    .catch(() => {
      /* Still locked. The next real gesture gets another go. */
    })
    .finally(() => {
      audio.muted = false;
    });
}

/** 0 to 1. Wire this to `settings.voice.outputVolume / 100`. */
export function setVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
  if (oneShot) oneShot.volume = volume;
  if (looper) looper.volume = volume;
}

/**
 * Route alerts to a chosen output device where the browser allows it.
 *
 * Better supported on an element than on an AudioContext, but still absent on
 * every phone browser, so a failure here is a no-op rather than an error.
 */
export async function setOutputDevice(deviceId: string | null): Promise<void> {
  sinkId = deviceId;
  await Promise.all([applySink(oneShot), applySink(looper)]);
}

async function applySink(audio: HTMLAudioElement | null): Promise<void> {
  const sinkable = audio as
    | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
    | null;
  if (!sinkable?.setSinkId) return;
  try {
    await sinkable.setSinkId(sinkId ?? '');
  } catch {
    /* Device unplugged between listing and choosing. Stay on the default. */
  }
}

async function play(key: string, pattern: Pattern, loop: boolean): Promise<void> {
  const audio = element(loop);
  const url = await urlFor(key, pattern, loop);
  if (!audio || !url) return;

  audio.src = url;
  audio.volume = volume;
  await applySink(audio);
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch {
    /* Blocked because nothing has been clicked yet. See unlock(). */
  }
}

/** A message arrived. */
export function playMessage(which: MessageSound = 'ding'): void {
  void play(`m:${which}`, MESSAGE_SOUNDS[which], false);
}

/** A one-off from the call set: `connected`, `ended`, or one cycle of `dialing`. */
export function playCallTone(which: keyof typeof CALL_SOUNDS): void {
  void play(`c:${which}`, CALL_SOUNDS[which], false);
}

/**
 * One cycle of a ring pattern, for auditioning it in settings.
 *
 * Deliberately not a loop. Someone comparing seven ringtones should hear each
 * one start and finish, not have to stop the last before trying the next.
 */
export function previewRing(which: RingSound): void {
  void play(`p:${which}`, RING_SOUNDS[which], false);
}

/** Stops a loop started by `startRing`. Safe to call twice. */
export type StopRing = () => void;

/**
 * Rings until the returned function is called.
 *
 * The element loops the rendered period, so the rhythm cannot drift and there
 * is no timer to keep alive while the tab is in the background, which is
 * exactly when a phone throttles timers and a scheduled ring would stutter.
 */
export function startRing(which: RingSound | 'dialing' = 'arpeggio'): StopRing {
  const pattern: Pattern = which === 'dialing' ? CALL_SOUNDS.dialing : RING_SOUNDS[which];
  let stopped = false;

  void play(`r:${which}`, pattern, true).then(() => {
    // Stopped while the first render was still going.
    if (stopped) looper?.pause();
  });

  return () => {
    if (stopped) return;
    stopped = true;
    looper?.pause();
  };
}
