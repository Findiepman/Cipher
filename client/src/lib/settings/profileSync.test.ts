/**
 * The two directions of profile sync, and the two words that change on the
 * way through. What matters most here is the empty case: a seed from the
 * server, fed straight back through `toRequest`, has to come out as nothing,
 * or every sign in would re-upload the whole profile and a slow network would
 * loop.
 */
import { describe, expect, it } from 'vitest';
import type { OwnProfileDto } from '../api/types';
import { isEmptyRequest, presenceToLocal, presenceToServer, toLocal, toRequest } from './profileSync';
import { DEFAULT_SETTINGS } from './types';

const AVATAR = 'data:image/jpeg;base64,/9j/4AAQ';

function serverProfile(overrides: Partial<OwnProfileDto> = {}): OwnProfileDto {
  return {
    displayName: 'Teto',
    about: 'bread',
    accent: '#6f93b0',
    avatar: AVATAR,
    banner: null,
    updatedAt: '2026-09-09T10:00:00.000Z',
    presence: 'invisible',
    readReceipts: false,
    friendRequestsFrom: 'friends_of_friends',
    ...overrides,
  };
}

describe('toLocal', () => {
  it('turns the server copy into the two settings sections', () => {
    expect(toLocal(serverProfile())).toEqual({
      profile: {
        displayName: 'Teto',
        about: 'bread',
        accent: '#6f93b0',
        avatar: AVATAR,
        banner: null,
        presence: 'offline',
      },
      privacy: { readReceipts: false, friendRequestsFrom: 'friends_of_friends' },
    });
  });

  it('reads a missing accent as the empty string, which means auto', () => {
    expect(toLocal(serverProfile({ accent: null })).profile.accent).toBe('');
  });
});

describe('toRequest', () => {
  it('sends nothing when the device already holds what the server holds', () => {
    const server = serverProfile();
    const local = toLocal(server);
    const request = toRequest(
      {
        profile: { ...DEFAULT_SETTINGS.profile, ...local.profile },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...local.privacy },
      },
      server,
    );

    expect(request).toEqual({});
    expect(isEmptyRequest(request)).toBe(true);
  });

  it('sends only the fields that differ', () => {
    const server = serverProfile();
    const local = toLocal(server);
    const request = toRequest(
      {
        profile: { ...DEFAULT_SETTINGS.profile, ...local.profile, about: 'baguette' },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...local.privacy, readReceipts: true },
      },
      server,
    );

    expect(request).toEqual({ about: 'baguette', readReceipts: true });
  });

  it('says invisible for the presence the client calls offline, and null for no accent', () => {
    const server = serverProfile({ presence: 'online', accent: '#6f93b0' });
    const request = toRequest(
      {
        profile: { ...DEFAULT_SETTINGS.profile, ...toLocal(server).profile, presence: 'offline', accent: '' },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...toLocal(server).privacy },
      },
      server,
    );

    expect(request).toEqual({ presence: 'invisible', accent: null });
  });

  it('trims the display name before comparing, so a trailing space is not an edit', () => {
    const server = serverProfile({ displayName: 'Teto' });
    const request = toRequest(
      {
        profile: { ...DEFAULT_SETTINGS.profile, ...toLocal(server).profile, displayName: 'Teto ' },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...toLocal(server).privacy },
      },
      server,
    );

    expect(request).toEqual({});
  });

  it('clears a picture with null rather than leaving it out', () => {
    const server = serverProfile({ avatar: AVATAR });
    const request = toRequest(
      {
        profile: { ...DEFAULT_SETTINGS.profile, ...toLocal(server).profile, avatar: null },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...toLocal(server).privacy },
      },
      server,
    );

    expect(request).toEqual({ avatar: null });
  });
});

describe('the two presence vocabularies', () => {
  it('round trip', () => {
    for (const presence of ['online', 'idle', 'dnd', 'offline'] as const) {
      expect(presenceToLocal(presenceToServer(presence))).toBe(presence);
    }
    expect(presenceToServer('offline')).toBe('invisible');
    expect(presenceToLocal('invisible')).toBe('offline');
  });
});
