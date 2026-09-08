// @vitest-environment jsdom
/**
 * The wiring around the alerts, not the alerts themselves.
 *
 * What the synthesis produces is checked by ear and by the shape of the score;
 * what cannot be checked by ear is whether the app ever earns the right to
 * play it. `unlock()` only counts when it runs inside a real user gesture, and
 * for a while nothing called it that way, so the first alert of a session was
 * refused by the autoplay policy and swallowed. That failure is invisible: no
 * error, no sound, nothing in the console. Hence these.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let plays: number;
let playedWith: string[];
/** Every Audio the module constructed, in order. */
let built: StubAudio[];

/** jsdom has no Audio. Only the calls matter here, not any sound. */
class StubAudio {
  muted = false;
  loop = false;
  volume = 1;
  currentTime = 0;
  src = '';
  preload = '';
  constructor() {
    built.push(this);
  }
  play(): Promise<void> {
    plays += 1;
    playedWith.push(this.src);
    return Promise.resolve();
  }
  pause(): void {}
}

/**
 * `gestureHooked` inside the module is deliberately one-shot, so each test
 * needs its own copy of the module rather than its own call.
 */
async function freshModule() {
  vi.resetModules();
  return import('./sounds');
}

beforeEach(() => {
  playedWith = [];
  built = [];
  vi.stubGlobal('Audio', StubAudio);
  // jsdom implements neither, and the unlock refuses to run without them
  // rather than throwing, so without these the test would pass by accident.
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:silence',
    revokeObjectURL: () => {},
  });
  // `vi.resetModules` gives each test its own copy of the module, but every
  // copy attaches to the same jsdom document, and a copy from an earlier test
  // is still listening. Each one lets go on its first gesture, so one throwaway
  // event clears them all. Counting starts after that, not before.
  document.dispatchEvent(new Event('pointerdown'));
  plays = 0;
  playedWith = [];
  built = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unlocking audio on the first gesture', () => {
  it('does nothing until something is actually clicked', async () => {
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    expect(plays).toBe(0);
  });

  it('plays its silent frame on the first pointer event', async () => {
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown'));
    expect(plays).toBe(1);
  });

  it('plays something real, because a source-less element cannot unlock anything', async () => {
    // Two bugs in one assertion, both of which failed silently and looked
    // identical to never having been called. `new Audio()` has no source, and
    // play() on one rejects with NotSupportedError instead of granting
    // playback. And the source has to be a blob: the desktop shell's CSP is
    // `media-src 'self' blob:`, so a data URL is refused before it can play.
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown'));
    expect(playedWith).toHaveLength(1);
    expect(playedWith[0]).toMatch(/^blob:/);
  });

  it('takes a key as readily as a click, since a form can be driven blind', async () => {
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    document.dispatchEvent(new Event('keydown'));
    expect(plays).toBe(1);
  });

  it('lets go afterwards rather than firing on every click for the session', async () => {
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    expect(plays).toBe(1);
  });

  it('unlocks through its own element, never the one the alerts share', async () => {
    // The nastiest of the three bugs, because it is silent and selective.
    // Muting the shared element and unmuting it from a promise means an
    // unsettled promise (a media load the CSP refuses will do it) mutes every
    // later chime for the whole session, while the ringtone carries on because
    // it plays through a different element. Reading that backwards from
    // "messages are silent but calls ring" is close to impossible.
    const module = await freshModule();
    module.unlockOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown'));

    expect(built).toHaveLength(1);
    expect(built[0]!.muted).toBe(true);

    // Asking for a message sound builds the shared one-shot element. jsdom has
    // no OfflineAudioContext so nothing is rendered or played, but the element
    // is made before that point, which is all this needs to see.
    module.playMessage('ding');
    expect(built).toHaveLength(2);
    expect(built[1]).not.toBe(built[0]);
    expect(built[1]!.muted).toBe(false);
  });

  it('is safe to call twice, so a remount does not double the listeners', async () => {
    const { unlockOnFirstGesture } = await freshModule();
    unlockOnFirstGesture();
    unlockOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown'));
    expect(plays).toBe(1);
  });
});
