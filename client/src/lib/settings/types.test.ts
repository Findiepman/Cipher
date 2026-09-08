/**
 * The settings that are read straight onto <html>, as attributes, as CSS
 * variables or as a url().
 *
 * The store checks a stored field against the type of its default and no
 * further, so these are the settings where a hand-edited (or older, or
 * corrupted) blob can put a string nobody wrote a CSS block for. For the
 * palette and the bar that means a missing style; for the two colours and the
 * wallpaper it means a string of somebody's choosing landing inside a
 * stylesheet, which is why those three are checked against a shape rather than
 * only against a type. These resolvers are the guard, and this is what they
 * promise.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BAR_POSITIONS,
  DEFAULT_SETTINGS,
  MAX_PINNED,
  PALETTES,
  readableInk,
  resolveActivityBar,
  resolveHex,
  resolvePalette,
  resolvePicture,
  resolvePinned,
} from './types';

describe('resolvePalette', () => {
  it('passes through every palette we ship', () => {
    for (const palette of PALETTES) {
      expect(resolvePalette(palette)).toBe(palette);
    }
  });

  it('passes through the custom one, which is not a swatch we ship', () => {
    expect(resolvePalette('custom')).toBe('custom');
  });

  it('falls back to Ember on anything else', () => {
    expect(resolvePalette('chartreuse')).toBe('ember');
    expect(resolvePalette('')).toBe('ember');
    // A palette name is not a theme name, and neither one is the other's.
    expect(resolvePalette('dark')).toBe('ember');
  });
});

describe('resolveHex', () => {
  it('passes through six hex digits, in either case', () => {
    expect(resolveHex('#f2734e', '#000000')).toBe('#f2734e');
    expect(resolveHex('#A1B2C3', '#000000')).toBe('#A1B2C3');
  });

  it('refuses anything that is not exactly that', () => {
    for (const bad of ['f2734e', '#f27', '#f2734ee', 'red', '', 'rgb(1,2,3)']) {
      expect(resolveHex(bad, '#000000')).toBe('#000000');
    }
  });

  it('refuses a value that would close the declaration and write another', () => {
    // The whole reason this function exists: the result is written into a CSS
    // variable, so a colour that is not a colour is a stylesheet.
    expect(resolveHex('red; background: url(http://x)', '#000000')).toBe('#000000');
  });
});

describe('resolvePicture', () => {
  it('passes through a base64 data URL of a kind a canvas produces', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolvePicture(png)).toBe(png);
    expect(resolvePicture('data:image/webp;base64,UklGRh4')).not.toBeNull();
  });

  it('refuses an address off the network, however it is dressed', () => {
    expect(resolvePicture('https://example.com/cat.png')).toBeNull();
    expect(resolvePicture('data:image/svg+xml,<svg onload="x"/>')).toBeNull();
    expect(resolvePicture(null)).toBeNull();
  });

  it('refuses one carrying a quote, which is how a url() gets closed early', () => {
    expect(resolvePicture('data:image/png;base64,AA"),url(http://x')).toBeNull();
  });
});

describe('resolvePinned', () => {
  it('keeps ids, in order, once each', () => {
    expect(resolvePinned(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('drops anything that is not an id', () => {
    expect(resolvePinned(['a', 3, null, { id: 'b' }, '', 'c'])).toEqual(['a', 'c']);
  });

  it('stops at the limit rather than growing without one', () => {
    const many = Array.from({ length: MAX_PINNED + 5 }, (_, index) => `p${index}`);
    expect(resolvePinned(many)).toHaveLength(MAX_PINNED);
  });
});

describe('readableInk', () => {
  it('goes dark on a pale accent and light on a dark one', () => {
    expect(readableInk('#ffe066')).toBe('#14100e');
    expect(readableInk('#1b2a6b')).toBe('#fdf8f5');
  });

  it('reads white as dark ink and black as light ink', () => {
    expect(readableInk('#ffffff')).toBe('#14100e');
    expect(readableInk('#000000')).toBe('#fdf8f5');
  });
});

describe('resolveActivityBar', () => {
  it('passes through every edge the bar can dock to', () => {
    for (const position of ACTIVITY_BAR_POSITIONS) {
      expect(resolveActivityBar(position)).toBe(position);
    }
  });

  it('falls back to the top on anything else', () => {
    expect(resolveActivityBar('middle')).toBe('top');
    expect(resolveActivityBar('')).toBe('top');
  });
});

describe('the defaults', () => {
  it('are values the resolvers accept, so a fresh install changes nothing', () => {
    const { appearance } = DEFAULT_SETTINGS;
    expect(resolvePalette(appearance.palette)).toBe(appearance.palette);
    expect(resolveActivityBar(appearance.activityBar)).toBe(appearance.activityBar);
    expect(resolveHex(appearance.customAccent, '#000000')).toBe(appearance.customAccent);
    expect(resolveHex(appearance.customTint, '#000000')).toBe(appearance.customTint);
    expect(resolvePicture(appearance.wallpaper)).toBeNull();
    expect(resolvePinned(DEFAULT_SETTINGS.sidebar.pinned)).toEqual([]);
  });
});
