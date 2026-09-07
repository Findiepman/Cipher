/**
 * The word filter is pure, so this suite needs no database and no app.
 *
 * The half worth guarding is the second one. Blocking a slur is easy; not
 * blocking "therapist", "torpedo", "pakistani", "mustard" and "connor" is the
 * part that quietly regresses the moment somebody moves a term between the two
 * lists, which is exactly what these cases exist to catch.
 */
import { describe, expect, it } from 'vitest';
import { normalizeHandle, screenUsername } from '../src/lib/usernameFilter.js';

describe('normalizeHandle', () => {
  it('folds case, accents, separators and lookalikes onto one form', () => {
    expect(normalizeHandle('N1gg3r')).toBe('nigger');
    expect(normalizeHandle('n.i.g.g.e.r')).toBe('nigger');
    expect(normalizeHandle('níggër')).toBe('nigger');
    expect(normalizeHandle('F_U_C_K')).toBe('fuck');
  });

  it('drops everything that is not a letter', () => {
    expect(normalizeHandle('__--..')).toBe('');
    expect(normalizeHandle('user-2026')).toBe('userzozg');
  });
});

describe('screenUsername', () => {
  it('lets an ordinary handle through', () => {
    for (const handle of ['nova', 'ren_kestrel', 'fin.diepman', 'user-9', 'teto']) {
      expect(screenUsername(handle), handle).toBeNull();
    }
  });

  it('refuses a slur wherever it sits in the handle', () => {
    expect(screenUsername('xX_nigger_Xx')).toBe('offensive');
    expect(screenUsername('the-faggot-99')).toBe('offensive');
    expect(screenUsername('fuckyou')).toBe('offensive');
  });

  it('sees through padding, spacing and digit substitution', () => {
    expect(screenUsername('n1gg3r')).toBe('offensive');
    expect(screenUsername('niiiggerrr')).toBe('offensive');
    expect(screenUsername('f.u.c.k')).toBe('offensive');
    expect(screenUsername('sh1t_lord')).toBe('offensive');
  });

  it('refuses an ambiguous word only when it is the whole handle', () => {
    expect(screenUsername('rape')).toBe('offensive');
    expect(screenUsername('pedo')).toBe('offensive');
    expect(screenUsername('paki')).toBe('offensive');
  });

  /// The Scunthorpe cases. Each of these contains a term from the whole-word
  /// list and none of them is offensive, so a term moved to the substring list
  /// fails here rather than in front of a user.
  it('does not refuse ordinary words that contain a blocked term', () => {
    for (const handle of [
      'therapist',
      'torpedo',
      'pakistani',
      'raccoon',
      'mustard',
      'suspicious',
      'lollipop',
      'connor',
      'cassidy',
      'cumberland',
      'analysis',
      'assange',
      'shiatsu',
      'mcpherson',
      'killarney',
      'spiceworld',
    ]) {
      expect(screenUsername(handle), handle).toBeNull();
    }
  });

  it('separates a reserved name from an offensive one', () => {
    expect(screenUsername('admin')).toBe('reserved');
    expect(screenUsername('support')).toBe('reserved');
    expect(screenUsername('cipher')).toBe('reserved');
    // Reserved is whole-match only, so the word inside a longer handle is fine.
    expect(screenUsername('supporter')).toBeNull();
    expect(screenUsername('admiral')).toBeNull();
  });

  it('refuses a handle that normalizes to nothing', () => {
    expect(screenUsername('_._._')).toBe('offensive');
  });
});
