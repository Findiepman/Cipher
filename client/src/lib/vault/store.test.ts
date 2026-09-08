/**
 * The vault's contract, which is mostly about what does *not* open it.
 *
 * These run against real libsodium and the in-memory secure store, so what is
 * asserted here is the actual sealing, not a stub of it. The two that matter
 * most are the wrong passkey (an offline guess must fail, not degrade) and the
 * password path (the promise that forgetting a passkey is survivable, which is
 * only true if it is tested).
 */
import { describe, expect, it } from 'vitest';
import { UnwrapError } from '@cipher/crypto';
import { MemorySecureStore } from '../storage/secureStore';
import { NoVaultError, VaultStore, type VaultEntry } from './store';

const PASSKEY = '318842';
const PASSWORD = 'correct-horse-battery-staple';
const USER = 'u-teto';

function makeStore() {
  const backing = new MemorySecureStore();
  return { backing, vault: new VaultStore(backing, USER) };
}

function entry(body: string): VaultEntry {
  return { id: `e-${body}`, body, createdAt: '2026-09-08T00:00:00.000Z' };
}

describe('VaultStore', () => {
  it('reports no vault before one is made', async () => {
    const { vault } = makeStore();
    expect(await vault.summary()).toEqual({ exists: false, kind: null, createdAt: null });
    await expect(vault.unlock(PASSKEY)).rejects.toBeInstanceOf(NoVaultError);
  });

  it('creates one, then opens it with the passkey', async () => {
    const { vault } = makeStore();
    const made = await vault.create(PASSKEY, PASSWORD, 'digits');

    const summary = await vault.summary();
    expect(summary.exists).toBe(true);
    expect(summary.kind).toBe('digits');

    const opened = await vault.unlock(PASSKEY);
    expect(Array.from(opened)).toEqual(Array.from(made));
    expect(await vault.entries(opened)).toEqual([]);
  });

  it('refuses the wrong passkey', async () => {
    const { vault } = makeStore();
    await vault.create(PASSKEY, PASSWORD, 'digits');

    await expect(vault.unlock('318843')).rejects.toBeInstanceOf(UnwrapError);
    // The account password is not the passkey, and must not be accepted as one.
    await expect(vault.unlock(PASSWORD)).rejects.toBeInstanceOf(UnwrapError);
  });

  it('opens with the account password when the passkey is gone', async () => {
    const { vault } = makeStore();
    const made = await vault.create(PASSKEY, PASSWORD, 'digits');

    const opened = await vault.unlockWithPassword(PASSWORD);

    expect(Array.from(opened)).toEqual(Array.from(made));
    await expect(vault.unlockWithPassword('not-it')).rejects.toBeInstanceOf(UnwrapError);
    // And the passkey is not the password either: the two wraps are separated
    // by their domain labels, not just by which function was called.
    await expect(vault.unlockWithPassword(PASSKEY)).rejects.toBeInstanceOf(UnwrapError);
  });

  it('keeps entries across a save and a fresh unlock', async () => {
    const { backing, vault } = makeStore();
    const key = await vault.create(PASSKEY, PASSWORD, 'digits');

    await vault.save(key, [entry('one'), entry('two')]);

    // A new store object over the same backing is what a reload looks like.
    const reopened = new VaultStore(backing, USER);
    const entries = await reopened.entries(await reopened.unlock(PASSKEY));
    expect(entries.map((e) => e.body)).toEqual(['one', 'two']);
  });

  it('never writes an entry where storage can read it', async () => {
    const { backing, vault } = makeStore();
    const key = await vault.create(PASSKEY, PASSWORD, 'digits');
    await vault.save(key, [entry('the spare key is under the pot')]);

    const raw = (await backing.get(`vault/v1/${USER}`)) ?? '';
    expect(raw).not.toContain('spare key');
    expect(raw).not.toContain(PASSKEY);
    expect(raw).not.toContain(PASSWORD);
  });

  it('changes the passkey without re-encrypting the entries', async () => {
    const { vault } = makeStore();
    const key = await vault.create(PASSKEY, PASSWORD, 'digits');
    await vault.save(key, [entry('kept')]);

    await vault.changePasskey(key, 'a-longer-one', 'mixed');

    await expect(vault.unlock(PASSKEY)).rejects.toBeInstanceOf(UnwrapError);
    const opened = await vault.unlock('a-longer-one');
    expect((await vault.entries(opened)).map((e) => e.body)).toEqual(['kept']);
    expect((await vault.summary()).kind).toBe('mixed');
    // The password wrap is untouched by a passkey change.
    expect(Array.from(await vault.unlockWithPassword(PASSWORD))).toEqual(Array.from(key));
  });

  it('re-wraps for a new account password, and the old one stops working', async () => {
    const { vault } = makeStore();
    const key = await vault.create(PASSKEY, PASSWORD, 'digits');

    await vault.rewrapForPassword(key, 'a-brand-new-password');

    await expect(vault.unlockWithPassword(PASSWORD)).rejects.toBeInstanceOf(UnwrapError);
    expect(Array.from(await vault.unlockWithPassword('a-brand-new-password'))).toEqual(
      Array.from(key),
    );
    // The passkey still opens it: changing a password is not losing the vault.
    expect(Array.from(await vault.unlock(PASSKEY))).toEqual(Array.from(key));
  });

  it('keeps one account away from another on a shared browser', async () => {
    const backing = new MemorySecureStore();
    const mine = new VaultStore(backing, 'u-teto');
    const theirs = new VaultStore(backing, 'u-nova');

    await mine.create(PASSKEY, PASSWORD, 'digits');

    expect((await theirs.summary()).exists).toBe(false);
    await expect(theirs.unlock(PASSKEY)).rejects.toBeInstanceOf(NoVaultError);
  });

  it('forgets everything when asked', async () => {
    const { vault } = makeStore();
    const key = await vault.create(PASSKEY, PASSWORD, 'digits');
    await vault.save(key, [entry('gone')]);

    await vault.forget();

    expect((await vault.summary()).exists).toBe(false);
    await expect(vault.unlockWithPassword(PASSWORD)).rejects.toBeInstanceOf(NoVaultError);
  });
});
