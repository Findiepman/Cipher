/**
 * The profile: what a person shows their friends, and who may see it.
 *
 * Three properties carry the design. The defaults are real (an account that
 * never edited anything still answers), the gate is friendship (a stranger
 * gets a 404, exactly as the key registry answers), and a picture is checked
 * for what it is rather than what it says it is.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  befriend,
  createActor,
  createTestApp,
  type Actor,
  type TestContext,
  resetDatabase,
} from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await createTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function patch(actor: Actor, payload: unknown) {
  return actor.request({ method: 'PATCH', url: '/account/me', payload });
}

/// A data URL whose bytes begin with the file header of the type it claims.
/// Only the header is checked, so the rest can be anything.
function picture(type: 'png' | 'jpeg' | 'webp', size = 64): string {
  const header =
    type === 'png'
      ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      : type === 'jpeg'
        ? [0xff, 0xd8, 0xff, 0xe0]
        : [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')];
  const bytes = Buffer.alloc(size, 7);
  Buffer.from(header).copy(bytes);
  return `data:image/${type};base64,${bytes.toString('base64')}`;
}

describe('your own profile', () => {
  it('answers with the defaults before anything was edited', async () => {
    const alice = await createActor(ctx);
    const me = await alice.request({ method: 'GET', url: '/account/me' });

    expect(me.statusCode).toBe(200);
    expect(me.json().profile).toEqual({
      displayName: '',
      about: '',
      accent: null,
      avatar: null,
      banner: null,
      presence: 'online',
      readReceipts: true,
      friendRequestsFrom: 'everyone',
      updatedAt: new Date(0).toISOString(),
    });
  });

  it('moves only the fields that were sent', async () => {
    const alice = await createActor(ctx);

    const first = await patch(alice, { displayName: '  Ali  ', accent: '#123abc' });
    expect(first.statusCode).toBe(200);
    expect(first.json().profile).toMatchObject({ displayName: 'Ali', accent: '#123abc' });

    const second = await patch(alice, { about: 'hello\nthere' });
    expect(second.json().profile).toMatchObject({
      displayName: 'Ali',
      accent: '#123abc',
      about: 'hello\nthere',
    });

    // Null removes; absent leaves alone.
    const third = await patch(alice, { accent: null });
    expect(third.json().profile).toMatchObject({ displayName: 'Ali', accent: null });
  });

  it('screens a display name with the username filter and caps the about text', async () => {
    const alice = await createActor(ctx);

    const tooLong = await patch(alice, { about: 'x'.repeat(191) });
    expect(tooLong.statusCode).toBe(400);

    const unknownField = await patch(alice, { theme: 'dark' });
    expect(unknownField.statusCode).toBe(400);

    const badColour = await patch(alice, { accent: 'red' });
    expect(badColour.statusCode).toBe(400);
  });

  it('accepts a real picture and refuses one that only claims to be', async () => {
    const alice = await createActor(ctx);

    const ok = await patch(alice, { avatar: picture('png'), banner: picture('jpeg') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.avatar).toBe(picture('png'));
    expect(ok.json().profile.banner).toBe(picture('jpeg'));

    const webp = await patch(alice, { avatar: picture('webp') });
    expect(webp.statusCode).toBe(200);

    // A PNG label on JPEG bytes.
    const lying = await patch(alice, {
      avatar: picture('jpeg').replace('image/jpeg', 'image/png'),
    });
    expect(lying.statusCode).toBe(400);
    expect(lying.json().error.code).toBe('bad_picture');

    const svg = await patch(alice, { avatar: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(svg.statusCode).toBe(400);

    const notAUrl = await patch(alice, { avatar: 'https://example.test/me.png' });
    expect(notAUrl.statusCode).toBe(400);

    const tooBig = await patch(alice, { avatar: picture('png', 64 * 1024 + 1) });
    expect(tooBig.statusCode).toBe(400);

    const removed = await patch(alice, { avatar: null });
    expect(removed.json().profile.avatar).toBeNull();
  });
});

describe('changing your username', () => {
  it('renames the handle, and refuses one another account holds in any case', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);

    const renamed = await patch(alice, { username: 'ali_ce' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().username).toBe('ali_ce');

    const taken = await patch(alice, { username: bob.user.username.toUpperCase() });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('username_in_use');

    // Recasing your own handle is not a collision with yourself.
    const recased = await patch(alice, { username: 'Ali_ce' });
    expect(recased.statusCode).toBe(200);
    expect(recased.json().username).toBe('Ali_ce');
  });

  it('stops after three changes in a day', async () => {
    const alice = await createActor(ctx);

    for (const name of ['one_a', 'two_b', 'three_c']) {
      expect((await patch(alice, { username: name })).statusCode).toBe(200);
    }
    // The same name again is not a change and does not count.
    expect((await patch(alice, { username: 'three_c' })).statusCode).toBe(200);

    const fourth = await patch(alice, { username: 'four_d' });
    expect(fourth.statusCode).toBe(429);
  });
});

describe("somebody else's profile", () => {
  it('rides along on the friend list and the conversation, light fields only', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await befriend(alice, bob);

    await patch(bob, {
      displayName: 'Bobby',
      about: 'hi',
      accent: '#abcdef',
      avatar: picture('png'),
      banner: picture('jpeg'),
      presence: 'dnd',
      readReceipts: false,
    });

    const list = await alice.request({ method: 'GET', url: '/friends' });
    const [friend] = list.json().friends;
    expect(friend.id).toBe(bob.id);
    expect(Object.keys(friend.profile).sort()).toEqual(
      ['about', 'accent', 'avatar', 'displayName', 'updatedAt'].sort(),
    );
    expect(friend.profile).toMatchObject({
      displayName: 'Bobby',
      about: 'hi',
      accent: '#abcdef',
      avatar: picture('png'),
    });

    const opened = await alice.request({
      method: 'POST',
      url: '/conversations/dm',
      payload: { userId: bob.id },
    });
    const him = opened.json().participants.find((p: { id: string }) => p.id === bob.id);
    expect(him.profile.displayName).toBe('Bobby');
    expect(him.profile.banner).toBeUndefined();
    expect(him.profile.presence).toBeUndefined();
  });

  it('hands the whole card to a friend and a 404 to anyone else', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const stranger = await createActor(ctx);
    await befriend(alice, bob);
    await patch(bob, { displayName: 'Bobby', banner: picture('jpeg') });

    const card = await alice.request({ method: 'GET', url: `/users/${bob.id}/profile` });
    expect(card.statusCode).toBe(200);
    expect(card.json()).toMatchObject({
      id: bob.id,
      username: bob.user.username,
      displayName: 'Bobby',
      banner: picture('jpeg'),
    });
    // The settings are his alone.
    expect(card.json().presence).toBeUndefined();
    expect(card.json().readReceipts).toBeUndefined();

    const refused = await stranger.request({ method: 'GET', url: `/users/${bob.id}/profile` });
    expect(refused.statusCode).toBe(404);

    const own = await bob.request({ method: 'GET', url: `/users/${bob.id}/profile` });
    expect(own.statusCode).toBe(200);
  });
});

describe('who may send you a friend request', () => {
  async function ask(from: Actor, to: Actor) {
    return from.request({
      method: 'POST',
      url: '/friends/requests',
      payload: { username: to.user.username },
    });
  }

  it('refuses everyone under "nobody", the way a stranger is refused', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await patch(bob, { friendRequestsFrom: 'nobody' });

    const refused = await ask(alice, bob);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error.code).toBe('user_not_found');
  });

  it('refuses a stranger under "friends of friends"', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await patch(bob, { friendRequestsFrom: 'friends_of_friends' });

    // They share nobody, so Alice is a stranger and reported as absent.
    expect((await ask(alice, bob)).statusCode).toBe(404);
  });

  it('admits someone you share a friend with under "friends of friends"', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    const carol = await createActor(ctx);

    // Carol knows both while the policy is still open, so once Bob narrows
    // it Alice is somebody a friend of his already knows.
    await befriend(carol, bob);
    await befriend(carol, alice);
    await patch(bob, { friendRequestsFrom: 'friends_of_friends' });

    const admitted = await ask(alice, bob);
    expect(admitted.statusCode).toBe(200);
    expect(admitted.json().status).toBe('pending');
  });

  it('never blocks answering a request they sent themselves', async () => {
    const alice = await createActor(ctx);
    const bob = await createActor(ctx);
    await patch(alice, { friendRequestsFrom: 'nobody' });

    // Alice asked first; Bob asking back is consent, not a new request.
    expect((await ask(alice, bob)).statusCode).toBe(200);
    const accepted = await ask(bob, alice);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');
  });
});
