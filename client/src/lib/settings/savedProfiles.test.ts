/**
 * The wardrobe rules.
 *
 * These reducers are pure and take both sections at once, so they can be
 * tested without React or storage, and what is checked here is the handful of
 * behaviours a person would actually notice: that saving does not change how
 * you look, that switching away never loses an edit, and that deleting a
 * saved profile does not undress you.
 *
 * The last group is about a settings file somebody has edited by hand. It is
 * the one input to the app a user can write directly, and the rule everywhere
 * else in settings is that a bad value falls back rather than stopping the
 * app from starting.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILES,
  addBlank,
  duplicate,
  remove,
  rename,
  resolveSavedProfiles,
  saveAs,
  suggestName,
  switchTo,
  type ProfilesState,
} from './savedProfiles';
import { DEFAULT_SETTINGS, type ProfileSettings } from './types';

function profile(over: Partial<ProfileSettings> = {}): ProfileSettings {
  return { ...DEFAULT_SETTINGS.profile, ...over };
}

/** Nothing saved yet, wearing whatever is passed in. */
function fresh(live: Partial<ProfileSettings> = {}): ProfilesState {
  return {
    profile: profile(live),
    profiles: { active: '', saved: [] },
    appearance: DEFAULT_SETTINGS.appearance,
  };
}

describe('saving a profile', () => {
  it('keeps the live one under a name without changing how you look', () => {
    const before = fresh({ displayName: 'teto', accent: '#f2734e' });

    const after = saveAs(before, 'day');

    expect(after.profile).toEqual(before.profile);
    expect(after.profiles.saved).toHaveLength(1);
    expect(after.profiles.saved[0].name).toBe('day');
    expect(after.profiles.saved[0].profile.displayName).toBe('teto');
    // Saving loads it, so later edits have somewhere to go.
    expect(after.profiles.active).toBe(after.profiles.saved[0].id);
  });

  it('will not hand out the same name twice', () => {
    const one = saveAs(fresh(), 'day');
    const two = saveAs({ ...one, profile: profile({ displayName: 'other' }) }, 'day');

    expect(two.profiles.saved.map((entry) => entry.name)).toEqual(['day', 'day 2']);
  });

  it('suggests a name that is not taken', () => {
    const one = saveAs(fresh(), 'Profile 2');
    expect(suggestName(one.profiles.saved)).not.toBe('Profile 2');
  });

  it('stops at the limit rather than growing forever', () => {
    let state = fresh();
    for (let n = 0; n < MAX_PROFILES + 3; n += 1) state = saveAs(state, `p${n}`);

    expect(state.profiles.saved).toHaveLength(MAX_PROFILES);
  });
});

describe('a new profile', () => {
  it('starts blank rather than as a copy of the one you are wearing', () => {
    const saved = saveAs(fresh({ displayName: 'teto', about: 'hello' }), 'day');

    const after = addBlank(saved, 'night');

    expect(after.profile.displayName).toBe('');
    expect(after.profile.about).toBe('');
    expect(after.profiles.active).toBe(after.profiles.saved[1].id);
  });

  it('shelves what you were wearing on the way out', () => {
    const saved = saveAs(fresh({ displayName: 'teto' }), 'day');
    // An edit made after saving, which the provider would normally mirror.
    const edited = { ...saved, profile: profile({ displayName: 'teto edited' }) };

    const after = addBlank(edited, 'night');

    expect(after.profiles.saved[0].profile.displayName).toBe('teto edited');
  });

  it('copies one when you ask for a copy', () => {
    const saved = saveAs(fresh({ displayName: 'teto', accent: '#6f93b0' }), 'day');

    const after = duplicate(saved, saved.profiles.saved[0].id, 'day copy');

    expect(after.profile.displayName).toBe('teto');
    expect(after.profile.accent).toBe('#6f93b0');
    expect(after.profiles.saved[1].id).not.toBe(after.profiles.saved[0].id);
  });
});

describe('switching', () => {
  it('writes the current one back before loading the other', () => {
    const day = saveAs(fresh({ displayName: 'day' }), 'day');
    const night = addBlank(day, 'night');
    const wearingNight = { ...night, profile: profile({ displayName: 'night' }) };

    const back = switchTo(wearingNight, day.profiles.saved[0].id);

    expect(back.profile.displayName).toBe('day');
    const stored = back.profiles.saved.map((entry) => entry.profile.displayName);
    expect(stored).toEqual(['day', 'night']);
  });

  it('does nothing for an id that is not on the shelf', () => {
    const saved = saveAs(fresh({ displayName: 'teto' }), 'day');
    expect(switchTo(saved, 'nope')).toBe(saved);
  });

  it('loads a copy, so editing one profile cannot edit another', () => {
    const day = saveAs(fresh({ displayName: 'day' }), 'day');
    const night = addBlank(day, 'night');

    const back = switchTo(night, day.profiles.saved[0].id);
    back.profile.displayName = 'changed in place';

    expect(back.profiles.saved[0].profile.displayName).toBe('day');
  });
});

describe('renaming and deleting', () => {
  it('trims a new name and refuses an empty one', () => {
    const saved = saveAs(fresh(), 'day');
    const id = saved.profiles.saved[0].id;

    expect(rename(saved, id, '  night  ').profiles.saved[0].name).toBe('night');
    expect(rename(saved, id, '   ')).toBe(saved);
  });

  it('leaves you dressed when the profile you are wearing is deleted', () => {
    const saved = saveAs(fresh({ displayName: 'teto', about: 'hello' }), 'day');

    const after = remove(saved, saved.profiles.saved[0].id);

    expect(after.profile.displayName).toBe('teto');
    expect(after.profile.about).toBe('hello');
    expect(after.profiles.saved).toHaveLength(0);
    expect(after.profiles.active).toBe('');
  });

  it('keeps the loaded one loaded when a different profile is deleted', () => {
    const day = saveAs(fresh({ displayName: 'day' }), 'day');
    const night = addBlank(day, 'night');

    const after = remove(night, day.profiles.saved[0].id);

    expect(after.profiles.active).toBe(night.profiles.active);
    expect(after.profiles.saved).toHaveLength(1);
  });
});

describe('reading a stored shelf back', () => {
  it('takes what is well formed and drops the rest', () => {
    const list = resolveSavedProfiles([
      { id: 'a', name: 'day', profile: { displayName: 'teto', accent: '#f2734e' } },
      { id: 'b' },
      { id: 'a', name: 'duplicate id', profile: {} },
      'not a profile',
      { id: 'c', name: '   ', profile: {} },
      { id: 'd', name: 'night', profile: {} },
    ]);

    expect(list.map((entry) => entry.id)).toEqual(['a', 'd']);
    expect(list[0].profile.displayName).toBe('teto');
  });

  it('falls back on a field of the wrong type, and on an unknown presence', () => {
    const list = resolveSavedProfiles([
      { id: 'a', name: 'day', profile: { displayName: 7, presence: 'lurking', avatar: null } },
    ]);

    expect(list[0].profile.displayName).toBe(DEFAULT_SETTINGS.profile.displayName);
    expect(list[0].profile.presence).toBe(DEFAULT_SETTINGS.profile.presence);
    expect(list[0].profile.avatar).toBeNull();
  });

  it('reads anything that is not a list as an empty shelf', () => {
    expect(resolveSavedProfiles({ nope: true })).toEqual([]);
    expect(resolveSavedProfiles(undefined)).toEqual([]);
  });

  it('will not load more than the limit', () => {
    const many = Array.from({ length: MAX_PROFILES + 5 }, (_, n) => ({
      id: `id-${n}`,
      name: `p${n}`,
      profile: {},
    }));

    expect(resolveSavedProfiles(many)).toHaveLength(MAX_PROFILES);
  });
});
