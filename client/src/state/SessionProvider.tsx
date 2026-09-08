/**
 * Session state for the UI.
 *
 * The state machine has four positions, and the third one is the one that only
 * exists because this app is end-to-end encrypted:
 *
 *   loading       (deciding, on first paint)
 *   anonymous     (no session)
 *   locked        (signed in, but the private key is not in memory, so message
 *                  history cannot be read yet)
 *   authenticated (signed in and unlocked)
 *
 * A conventional app would collapse `locked` into `authenticated`. Here it has
 * to be visible: the server can restore a session, but only a secret the server
 * does not hold can restore the ability to read anything.
 *
 * A reload usually lands on `authenticated` rather than `locked`, because
 * KeyManager.restore() reopens the key from this device's own key store. The
 * `locked` position is still reached, by pressing Lock, by signing in on a new
 * device, and once the remembered unlock expires, so nothing may assume it away.
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
import { ApiError, api } from '../lib/api';
import type { AccountDto } from '../lib/api/types';
import { isMockBackend } from '../lib/config';
import { AuthService, authService as defaultAuthService } from '../lib/session/authService';
import { keyManager as defaultKeyManager, type KeyManager, type KeyState } from '../lib/session/keyManager';

export type SessionStatus = 'loading' | 'anonymous' | 'locked' | 'authenticated';

export interface SessionContextValue {
  status: SessionStatus;
  account: AccountDto | null;
  keyState: KeyState;
  /** Last error from a session action, cleared when the next one starts. */
  error: ApiError | Error | null;
  busy: boolean;

  register: (input: { email: string; username: string; password: string }) => Promise<{ recoveryCode: string }>;
  login: (input: { email: string; password: string }) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the account from the server. */
  refresh: () => Promise<void>;
  auth: AuthService;
}

/** Exported so tests can mount a screen against a stub session. */
export const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  children: ReactNode;
  /** Injectable for tests and Storybook. */
  auth?: AuthService;
  keys?: KeyManager;
}

export function SessionProvider({
  children,
  auth = defaultAuthService,
  keys = defaultKeyManager,
}: SessionProviderProps) {
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [keyState, setKeyState] = useState<KeyState>(keys.state);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => keys.subscribe(setKeyState), [keys]);

  /** Wraps an action so every caller gets the same busy/error handling. */
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      const normalized = caught instanceof Error ? caught : new Error(String(caught));
      if (mounted.current) setError(normalized);
      throw normalized;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  /** First paint: is there a session, and is the key available? */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // Both are reads of what the last launch left on this device: the
      // identity, and (in bearer mode) the session. Neither needs the other.
      await Promise.all([keys.restore(), auth.restoreSession()]);
      if (isMockBackend) {
        // No server to ask. The UI decides what to show for a signed-out user.
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const me = await auth.me();
        if (cancelled) return;
        setAccount(me);
        setStatus(keys.state === 'unlocked' ? 'authenticated' : 'locked');
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [auth, keys]);

  /**
   * A refresh that fails server-side means the session is genuinely over,
   * clear local state rather than leaving a signed-in-looking shell.
   */
  useEffect(() => {
    api.setSessionExpiredHandler(() => {
      setAccount(null);
      setStatus('anonymous');
      void keys.lock();
    });
  }, [keys]);

  const register = useCallback(
    (input: { email: string; username: string; password: string }) =>
      run(() => auth.register(input)),
    [auth, run],
  );

  const login = useCallback(
    (input: { email: string; password: string }) =>
      run(async () => {
        const me = await auth.login(input);
        setAccount(me);
        setStatus(keys.state === 'unlocked' ? 'authenticated' : 'locked');
      }),
    [auth, keys, run],
  );

  const unlock = useCallback(
    (password: string) =>
      run(async () => {
        await auth.unlock(password);
        setStatus('authenticated');
      }),
    [auth, run],
  );

  const lock = useCallback(async () => {
    // The status flips first so the UI never waits on storage, and the await is
    // only the device key being destroyed. See KeyManager.lock().
    setStatus(account ? 'locked' : 'anonymous');
    await auth.lock();
  }, [account, auth]);

  const logout = useCallback(
    () =>
      run(async () => {
        await auth.logout();
        setAccount(null);
        setStatus('anonymous');
      }),
    [auth, run],
  );

  const refresh = useCallback(
    () =>
      run(async () => {
        setAccount(await auth.me());
      }),
    [auth, run],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      account,
      keyState,
      error,
      busy,
      register,
      login,
      unlock,
      lock,
      logout,
      refresh,
      auth,
    }),
    [status, account, keyState, error, busy, register, login, unlock, lock, logout, refresh, auth],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside a <SessionProvider>');
  }
  return context;
}
