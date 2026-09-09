/**
 * What a person looks like once the server's row and their profile meet.
 *
 * The order of names is the thing worth pinning down: a nickname you gave
 * someone beats the display name they chose, which beats their handle. Get
 * that backwards and somebody can rename themselves out from under your label.
 */
import { describe, expect, it } from 'vitest';
import type { FriendDto, PublicProfileDto } from './api/types';
import { colorFor, friendToUser, toUser } from './presentation';

const profile: PublicProfileDto = {
  displayName: 'Kasane Teto',
  about: '  bread  ',
  accent: '#6f93b0',
  avatar: 'data:image/jpeg;base64,/9j/4AAQ',
  updatedAt: '2026-09-09T10:00:00.000Z',
};

const teto: FriendDto = {
  id: 'u-teto',
  username: 'teto',
  publicKey: null,
  nickname: null,
  friendsSince: '2026-09-01T00:00:00.000Z',
  profile,
};

describe('toUser', () => {
  it('draws the display name, picture, accent and about text from the profile', () => {
    const user = friendToUser(teto, 'idle');

    expect(user).toMatchObject({
      name: 'Kasane Teto',
      username: 'teto',
      color: '#6f93b0',
      avatarUrl: profile.avatar,
      activity: 'bread',
      presence: 'idle',
      profileUpdatedAt: profile.updatedAt,
    });
    expect(user.nickname).toBeUndefined();
  });

  it('lets your nickname beat their display name, and keeps the handle', () => {
    const user = friendToUser({ ...teto, nickname: 'Kasane' }, 'online');

    expect(user.name).toBe('Kasane');
    expect(user.nickname).toBe('Kasane');
    expect(user.username).toBe('teto');
  });

  it('falls back to the handle and the derived colour for an empty profile', () => {
    const user = toUser(
      {
        ...teto,
        profile: { displayName: '  ', about: '', accent: null, avatar: null, updatedAt: '' },
      },
      'offline',
    );

    expect(user.name).toBe('teto');
    expect(user.color).toBe(colorFor('u-teto'));
    expect(user.avatarUrl).toBeUndefined();
    expect(user.activity).toBeUndefined();
  });

  it('copes with no profile at all', () => {
    const user = toUser({ id: 'u-x', username: 'x', publicKey: null }, 'offline');

    expect(user.name).toBe('x');
    expect(user.color).toBe(colorFor('u-x'));
  });
});
