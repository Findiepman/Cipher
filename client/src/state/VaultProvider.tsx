/**
 * The vault, as the UI sees it.
 *
 * Three phases and the screen renders all of them: `absent` (never set up on
 * this device), `locked` (a vault is here, the passkey is not) and `open`. The
 * shape is deliberately the same as the session's empty/locked/unlocked,
 * because it is the same idea one level in, and a reader who has understood
 * `keyManager.ts` should not have to learn a second vocabulary.
 *
 * The vault key lives in a ref and nowhere else: not in state, so a render
 * cannot leak it into a devtools snapshot, and not in storage, because the
 * whole point is that opening the vault costs the passkey. Locking the app
 * drops it, and so does signing out, which is what stops a shared machine from
 * handing the next person an open vault.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { UnwrapError, wipe } from '@cipher/crypto';
import type { Key } from '../lib/i18n/en';
import {
  NoVaultError,
  VaultStore,
  type VaultBackend,
  type VaultEntry,
} from '../lib/vault/store';
import type { PasskeyKind } from '../lib/vault/passkeyPolicy';
import { createSecureStore } from '../lib/storage/secureStore';
import { useSession } from './SessionProvider';

export type VaultPhase = 'absent' | 'locked' | 'open';

export interface VaultContextValue {
  phase: VaultPhase;
  /** Which shape the stored passkey is, so the unlock screen can say so. */
  kind: PasskeyKind | null;
  entries: VaultEntry[];
  busy: boolean;
  /**
   * Last failure, as a catalogue key for the screen to translate. A key rather
   * than a sentence because this provider does not know what language it is
   * being rendered in, and an error is the last thing that should come out in
   * the wrong one. Cleared by the next attempt.
   */
  error: Key | null;

  create: (input: {
    passkey: string;
    password: string;
    kind: PasskeyKind;
  }) => Promise<void>;
  unlock: (passkey: string) => Promise<void>;
  /** The way in when the passkey is gone. Opens the vault, does not change it. */
  unlockWithPassword: (password: string) => Promise<void>;
  /** Changing it always costs the account password, never just the old passkey. */
  changePasskey: (input: {
    password: string;
    passkey: string;
    kind: PasskeyKind;
  }) => Promise<void>;
  lock: () => void;
  add: (body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  forget: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({
  children,
  store,
}: {
  children: ReactNode;
  /** Injectable for tests. Built from the session's account id otherwise. */
  store?: VaultBackend;
}) {
  const { account, status, auth } = useSession();
  const [phase, setPhase] = useState<VaultPhase>('absent');
  const [kind, setKind] = useState<PasskeyKind | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);

  // Memory only. Never state, never storage.
  const keyRef = useRef<Uint8Array | null>(null);

  const vault = useMemo(
    () => store ?? (account ? new VaultStore(createSecureStore(), account.id) : null),
    [store, account],
  );

  const drop = useCallback(() => {
    if (keyRef.current) wipe(keyRef.current);
    keyRef.current = null;
    setEntries([]);
  }, []);

  /** Is there a vault here at all, and what shape is its passkey. */
  useEffect(() => {
    let live = true;
    if (!vault) {
      setPhase('absent');
      setKind(null);
      return;
    }
    void vault.summary().then((summary) => {
      if (!live) return;
      setKind(summary.kind);
      // An open vault stays open across this refresh: `summary` is about what is
      // stored, and the key in memory is what decides the phase.
      setPhase(keyRef.current ? 'open' : summary.exists ? 'locked' : 'absent');
    });
    return () => {
      live = false;
    };
  }, [vault]);

  /**
   * Locking or signing out of the app closes the vault too. A vault that
   * outlived the lock screen would be a way around it.
   */
  useEffect(() => {
    if (status !== 'authenticated') {
      drop();
      setPhase((current) => (current === 'open' ? 'locked' : current));
    }
  }, [status, drop]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      setBusy(true);
      setError(null);
      try {
        return await action();
      } catch (caught) {
        setError(describe(caught));
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const open = useCallback(
    async (key: Uint8Array) => {
      if (!vault) return;
      keyRef.current = key;
      setEntries(await vault.entries(key));
      setPhase('open');
    },
    [vault],
  );

  const create = useCallback<VaultContextValue['create']>(
    async ({ passkey, password, kind: nextKind }) => {
      if (!vault) return;
      await run(async () => {
        // Checked before anything is written: a typo here would not surface
        // until the day the passkey is forgotten, which is the worst possible
        // moment to learn that the way back in was never real.
        if (!(await auth.verifyPassword(password))) {
          throw new WrongAccountPassword();
        }
        const key = await vault.create(passkey, password, nextKind);
        setKind(nextKind);
        await open(key);
      });
    },
    [auth, open, run, vault],
  );

  const unlock = useCallback<VaultContextValue['unlock']>(
    async (passkey) => {
      if (!vault) return;
      await run(async () => open(await vault.unlock(passkey)));
    },
    [open, run, vault],
  );

  const unlockWithPassword = useCallback<VaultContextValue['unlockWithPassword']>(
    async (password) => {
      if (!vault) return;
      await run(async () => open(await vault.unlockWithPassword(password)));
    },
    [open, run, vault],
  );

  const changePasskey = useCallback<VaultContextValue['changePasskey']>(
    async ({ password, passkey, kind: nextKind }) => {
      if (!vault) return;
      await run(async () => {
        const key = await vault.unlockWithPassword(password);
        await vault.changePasskey(key, passkey, nextKind);
        setKind(nextKind);
        await open(key);
      });
    },
    [open, run, vault],
  );

  const lock = useCallback(() => {
    drop();
    setPhase((current) => (current === 'open' ? 'locked' : current));
  }, [drop]);

  const add = useCallback<VaultContextValue['add']>(
    async (body) => {
      const key = keyRef.current;
      if (!vault || !key) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      const next = [
        ...entries,
        { id: crypto.randomUUID(), body: trimmed, createdAt: new Date().toISOString() },
      ];
      await run(async () => {
        await vault.save(key, next);
        setEntries(next);
      });
    },
    [entries, run, vault],
  );

  const remove = useCallback<VaultContextValue['remove']>(
    async (id) => {
      const key = keyRef.current;
      if (!vault || !key) return;
      const next = entries.filter((item) => item.id !== id);
      await run(async () => {
        await vault.save(key, next);
        setEntries(next);
      });
    },
    [entries, run, vault],
  );

  const forget = useCallback<VaultContextValue['forget']>(async () => {
    if (!vault) return;
    await run(async () => {
      await vault.forget();
      drop();
      setKind(null);
      setPhase('absent');
    });
  }, [drop, run, vault]);

  const value = useMemo<VaultContextValue>(
    () => ({
      phase,
      kind,
      entries,
      busy,
      error,
      create,
      unlock,
      unlockWithPassword,
      changePasskey,
      lock,
      add,
      remove,
      forget,
    }),
    [
      phase,
      kind,
      entries,
      busy,
      error,
      create,
      unlock,
      unlockWithPassword,
      changePasskey,
      lock,
      add,
      remove,
      forget,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) throw new Error('useVault must be used inside a <VaultProvider>');
  return context;
}

/**
 * Wrong account password, told apart from a wrong passkey.
 *
 * They are not the same failure and the difference is not an oracle: this one
 * is only ever raised while setting a vault up, by someone who has already
 * proved they are signed in.
 */
export class WrongAccountPassword extends Error {
  constructor() {
    super('That is not your account password.');
    this.name = 'WrongAccountPassword';
  }
}

/**
 * One message for every way a secret can fail to open something, because
 * telling the caller which kind of wrong it was is an oracle. The same
 * reasoning as `UnwrapError` in packages/crypto.
 */
function describe(error: unknown): Key {
  if (error instanceof NoVaultError) return 'vault.error.noVault';
  if (error instanceof WrongAccountPassword) return 'vault.error.wrongPassword';
  if (error instanceof UnwrapError) return 'vault.error.wrongSecret';
  return 'vault.error.generic';
}
