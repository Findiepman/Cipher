// @vitest-environment jsdom
/**
 * The vault screen, driven the way a person drives it.
 *
 * The backend here is a stub, not the real `VaultStore`, and that is forced
 * rather than lazy: under jsdom libsodium rejects the test realm's typed arrays
 * (`client/vite.config.ts` explains why the DOM suites are scoped), so a screen
 * test cannot do real Argon2id at all. The sealing claims are proved next door
 * in `lib/vault/store.test.ts`, which runs in node against real libsodium. What
 * is tested here is the part that lives in the screen: which phase is shown,
 * what a wrong secret does, and that the account password is offered as the way
 * back in.
 *
 * Rendered inside <StrictMode> like the other component tests, because the
 * provider reads the vault from an effect and a single pass hides what that
 * makes possible.
 */
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnwrapError } from '@cipher/crypto';
import { NoVaultError, type VaultBackend, type VaultEntry } from '../lib/vault/store';
import type { PasskeyKind } from '../lib/vault/passkeyPolicy';
import type { SessionContextValue } from '../state/SessionProvider';
import { SessionContext } from '../state/SessionProvider';
import { I18nProvider } from '../state/I18nProvider';
import { SettingsProvider } from '../state/SettingsProvider';
import { VaultProvider } from '../state/VaultProvider';
import { VaultScreen } from './VaultScreen';

afterEach(cleanup);

const PASSKEY = '318842';
const PASSWORD = 'correct-horse-battery-staple';

/**
 * The same contract as `VaultStore`, with string comparison where the real one
 * does Argon2id. It still refuses a wrong secret, which is the behaviour the
 * screen is written against.
 */
class FakeVault implements VaultBackend {
  private passkey: string | null = null;
  private password: string | null = null;
  private kind: PasskeyKind = 'digits';
  private notes: VaultEntry[] = [];
  readonly key = new Uint8Array([1, 2, 3]);

  async summary() {
    return {
      exists: this.passkey !== null,
      kind: this.passkey === null ? null : this.kind,
      createdAt: null,
    };
  }

  async create(passkey: string, password: string, kind: PasskeyKind) {
    this.passkey = passkey;
    this.password = password;
    this.kind = kind;
    return this.key;
  }

  async unlock(passkey: string) {
    if (this.passkey === null) throw new NoVaultError();
    if (passkey !== this.passkey) throw new UnwrapError();
    return this.key;
  }

  async unlockWithPassword(password: string) {
    if (this.passkey === null) throw new NoVaultError();
    if (password !== this.password) throw new UnwrapError();
    return this.key;
  }

  async entries() {
    return this.notes;
  }

  async save(_key: Uint8Array, entries: VaultEntry[]) {
    this.notes = entries;
  }

  async changePasskey(_key: Uint8Array, passkey: string, kind: PasskeyKind) {
    this.passkey = passkey;
    this.kind = kind;
  }

  async forget() {
    this.passkey = null;
    this.notes = [];
  }
}

function renderVault(options: { passwordOk?: boolean; locale?: 'en' | 'nl' } = {}) {
  const vault = new FakeVault();
  const verifyPassword = vi.fn(() => Promise.resolve(options.passwordOk ?? true));
  const session = {
    status: 'authenticated',
    account: { id: 'u-teto' },
    auth: { verifyPassword },
  } as unknown as SessionContextValue;

  // The language is pinned rather than left to the browser, so the assertions
  // below are about the screen and not about whatever locale CI happens to run
  // in. Every string here comes from the catalogue via `t`.
  render(
    <StrictMode>
      <SettingsProvider>
        <I18nProvider locale={options.locale ?? 'en'}>
          <SessionContext.Provider value={session}>
            <VaultProvider store={vault}>
              <VaultScreen />
            </VaultProvider>
          </SessionContext.Provider>
        </I18nProvider>
      </SettingsProvider>
    </StrictMode>,
  );

  return { vault, verifyPassword };
}

/** Fills the setup form and submits it. */
async function makeVault() {
  fireEvent.change(await screen.findByLabelText('Passkey'), {
    target: { value: PASSKEY },
  });
  fireEvent.change(screen.getByLabelText('Passkey again'), { target: { value: PASSKEY } });
  fireEvent.change(screen.getByLabelText('Your account password'), {
    target: { value: PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Make the vault' }));
  await screen.findByPlaceholderText('keep something');
}

describe('the vault screen', () => {
  it('offers to make one, and says what a six digit passkey is worth', async () => {
    renderVault();

    expect(await screen.findByText('Make a vault')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Passkey'), { target: { value: PASSKEY } });
    expect(screen.getByText('about 1 million combinations')).toBeTruthy();
  });

  it('will not seal anything until the account password is right', async () => {
    const { vault, verifyPassword } = renderVault({ passwordOk: false });

    fireEvent.change(await screen.findByLabelText('Passkey'), {
      target: { value: PASSKEY },
    });
    fireEvent.change(screen.getByLabelText('Passkey again'), { target: { value: PASSKEY } });
    fireEvent.change(screen.getByLabelText('Your account password'), {
      target: { value: 'not-my-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Make the vault' }));

    expect(await screen.findByText('That is not your account password.')).toBeTruthy();
    expect(verifyPassword).toHaveBeenCalled();
    // Nothing was written, so the setup form is still the screen.
    expect((await vault.summary()).exists).toBe(false);
    expect(screen.getByText('Make a vault')).toBeTruthy();
  });

  it('will not submit a passkey that does not match its confirmation', async () => {
    renderVault();

    fireEvent.change(await screen.findByLabelText('Passkey'), {
      target: { value: PASSKEY },
    });
    fireEvent.change(screen.getByLabelText('Passkey again'), { target: { value: '318843' } });
    fireEvent.change(screen.getByLabelText('Your account password'), {
      target: { value: PASSWORD },
    });

    expect(screen.getByText('The two passkeys do not match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make the vault' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('makes one, then keeps a note in it', async () => {
    const { vault } = renderVault();
    await makeVault();

    const composer = screen.getByPlaceholderText('keep something');
    fireEvent.change(composer, { target: { value: 'the spare key is under the pot' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    expect(await screen.findByText('the spare key is under the pot')).toBeTruthy();
    await waitFor(async () => {
      expect((await vault.entries()).map((note) => note.body)).toEqual([
        'the spare key is under the pot',
      ]);
    });
  });

  it('shuts again on Lock, and refuses the wrong passkey', async () => {
    renderVault();
    await makeVault();

    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));

    fireEvent.change(await screen.findByLabelText('Passkey'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(
      await screen.findByText('Could not unlock this key with the secret provided.'),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('keep something')).toBeNull();
  });

  it('opens with the right passkey, with the note still in it', async () => {
    renderVault();
    await makeVault();

    const composer = screen.getByPlaceholderText('keep something');
    fireEvent.change(composer, { target: { value: 'kept' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await screen.findByText('kept');

    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    fireEvent.change(await screen.findByLabelText('Passkey'), {
      target: { value: PASSKEY },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText('kept')).toBeTruthy();
  });

  it('offers the account password as the way back in', async () => {
    renderVault();
    await makeVault();
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));

    fireEvent.click(await screen.findByText('I have forgotten the passkey'));
    expect(screen.queryByLabelText('Passkey')).toBeNull();

    fireEvent.change(screen.getByLabelText('Your account password'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByPlaceholderText('keep something')).toBeTruthy();
  });
});

describe('the same screen in Dutch', () => {
  it('renders the copy, the rules and the count in Dutch', async () => {
    renderVault({ locale: 'nl' });

    expect(await screen.findByText('Een kluis maken')).toBeTruthy();

    // Not just the labels: the honest line about what a passkey is worth comes
    // from `combinations()` in lib, which returns a key rather than a sentence
    // precisely so it can arrive here in the right language.
    fireEvent.change(screen.getByLabelText('Toegangscode'), {
      target: { value: PASSKEY },
    });
    expect(screen.getByText('ongeveer 1 miljoen combinaties')).toBeTruthy();
  });

  it('keeps one note singular and two plural', async () => {
    renderVault({ locale: 'nl' });

    fireEvent.change(screen.getByLabelText('Toegangscode'), { target: { value: PASSKEY } });
    fireEvent.change(screen.getByLabelText('Toegangscode nogmaals'), {
      target: { value: PASSKEY },
    });
    fireEvent.change(screen.getByLabelText('Je accountwachtwoord'), {
      target: { value: PASSWORD },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Maak de kluis' }));

    const composer = await screen.findByPlaceholderText('bewaar iets');
    fireEvent.change(composer, { target: { value: 'eerste' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(await screen.findByText('1 notitie, op dit apparaat')).toBeTruthy();

    fireEvent.change(composer, { target: { value: 'tweede' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(await screen.findByText('2 notities, op dit apparaat')).toBeTruthy();
  });
});
