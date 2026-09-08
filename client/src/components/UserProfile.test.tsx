// @vitest-environment jsdom
/**
 * The profile prefab.
 *
 * It takes a `User` and nothing else, so these tests are the contract: what it
 * shows, which actions it offers to whom and the one thing it must never stop
 * doing, which is showing the real username alongside a nickname. A nickname
 * replaces the handle everywhere else in the app, so this card is the only
 * place left to check who you are actually talking to.
 */
import { Providers } from '../test/providers';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserProfile } from './UserProfile';
import type { User } from '../types';

afterEach(cleanup);

const teto: User = {
  id: 'u-teto',
  name: 'teto',
  username: 'teto',
  color: '#f2734e',
  presence: 'online',
};

function renderProfile(user: User, options: { isFriend?: boolean; friendsSince?: string } = {}) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(
    <StrictMode>
      <Providers>
      <UserProfile
        user={user}
        isFriend={options.isFriend ?? true}
        friendsSince={options.friendsSince}
        onAction={onAction}
        onClose={onClose}
      />
      </Providers>
    </StrictMode>,
  );
  return { onAction, onClose };
}

describe('what it shows', () => {
  it('shows the name and the handle', () => {
    renderProfile(teto);

    expect(screen.getByRole('heading', { name: 'teto' })).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('keeps the real username visible under a nickname', () => {
    renderProfile({ ...teto, name: 'Kasane', nickname: 'Kasane' });

    expect(screen.getByRole('heading', { name: 'Kasane' })).toBeTruthy();
    // The handle is still there, and labelled as private to you.
    expect(screen.getByText('teto')).toBeTruthy();
    expect(screen.getByText('only you see this')).toBeTruthy();
  });

  it('omits the friends-since row for someone who is not a friend', () => {
    renderProfile(teto, { isFriend: false });

    expect(screen.queryByText('Friends since')).toBeNull();
  });
});

describe('the actions it offers', () => {
  it('offers the friend-only actions to a friend', () => {
    renderProfile(teto);

    expect(screen.getByRole('button', { name: /Message/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove friend/ })).toBeTruthy();
  });

  /// Blocking and nicknaming stay: you can block someone you never befriended,
  /// and a conversation partner who unfriended you still has to be labellable.
  it('hides them from a non-friend but keeps block and nickname', () => {
    renderProfile(teto, { isFriend: false });

    expect(screen.queryByRole('button', { name: /Message/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove friend/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Block/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add nickname/ })).toBeTruthy();
  });

  it('says change rather than add when there is already a nickname', () => {
    renderProfile({ ...teto, name: 'Kasane', nickname: 'Kasane' });

    expect(screen.getByRole('button', { name: /Change nickname/ })).toBeTruthy();
  });

  it('reports each action by name', () => {
    const { onAction } = renderProfile(teto);

    fireEvent.click(screen.getByRole('button', { name: /Message/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add nickname/ }));
    fireEvent.click(screen.getByRole('button', { name: /Remove friend/ }));
    fireEvent.click(screen.getByRole('button', { name: /Block/ }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'message',
      'nickname',
      'unfriend',
      'block',
    ]);
  });

  it('closes when asked', () => {
    const { onClose } = renderProfile(teto);

    fireEvent.click(screen.getByRole('button', { name: 'Close profile' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
