/**
 * The desktop app's own settings: the shell around the page.
 *
 * Only reachable in a desktop build (SettingsScreen leaves the entry out
 * elsewhere), so everything here may assume `platform.updates` and
 * `platform.prefs` exist, and says so loudly if they do not.
 *
 * Two of the three things here are not preferences at all. The version and
 * the update check are facts about the installed binary; "start with your
 * computer" is a registry key or a launch agent the operating system owns,
 * read from it rather than remembered here. Only "close to tray" is a
 * setting in the usual sense, and it lives with the others in lib/settings.
 */
import { useEffect, useState } from 'react';
import { Actions, Group, Note, Row, Toggle } from '../../components/settings/controls';
import type { OperatingSystem, UpdateCheck, UpdateInfo, UpdateProgress } from '../../lib/platform';
import { describeProgress } from '../../lib/platform/progress';
import { usePlatform } from '../../state/PlatformProvider';
import { useSettings } from '../../state/SettingsProvider';
import { describe } from './AccountSection';

export function DesktopSection() {
  const platform = usePlatform();
  const [version, setVersion] = useState<string | null>(null);
  const [os, setOs] = useState<OperatingSystem | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([platform.version(), platform.os()]).then(([v, o]) => {
      if (!live) return;
      setVersion(v);
      setOs(o);
    });
    return () => {
      live = false;
    };
  }, [platform]);

  if (!platform.updates || !platform.prefs) {
    return (
      <Note tone="warn">
        This build is not running inside the desktop app, so there is nothing
        here to set.
      </Note>
    );
  }

  return (
    <>
      <Group title="this app">
        <Row label="Version" hint="The installed desktop app. The chat itself ships inside it.">
          <span className="set-value mono">{version ?? '…'}</span>
        </Row>
        <UpdateRow />
      </Group>

      <Group title="window">
        {/* macOS keeps an app alive with no windows as a matter of course, and
            the dock icon is how you get it back, so the choice is not offered
            there: closing the window always leaves the app running. */}
        {os !== 'macos' && <CloseToTrayRow />}
        <AutostartRow />
      </Group>
    </>
  );
}

/* --------------------------------------------------------------- updates --- */

function UpdateRow() {
  const platform = usePlatform();
  const updates = platform.updates!;
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'result'; check: UpdateCheck }
    | { kind: 'installing'; update: UpdateInfo; progress: UpdateProgress | null }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  // An update the shell found on its own, before this screen was opened.
  useEffect(() => {
    let live = true;
    void updates.pending().then((pending) => {
      if (live && pending) setState({ kind: 'result', check: { status: 'available', update: pending } });
    });
    const stop = updates.onAvailable((update) => {
      if (live) setState({ kind: 'result', check: { status: 'available', update } });
    });
    return () => {
      live = false;
      stop();
    };
  }, [updates]);

  useEffect(() => {
    if (state.kind !== 'installing') return;
    return updates.onProgress((progress) => {
      setState((current) =>
        current.kind === 'installing' ? { ...current, progress } : current,
      );
    });
  }, [state.kind, updates]);

  async function check() {
    setState({ kind: 'checking' });
    try {
      setState({ kind: 'result', check: await updates.check() });
    } catch (caught) {
      setState({ kind: 'failed', message: describe(caught) });
    }
  }

  async function install(update: UpdateInfo) {
    setState({ kind: 'installing', update, progress: null });
    try {
      // Resolving at all means the restart did not happen.
      await updates.install();
      setState({ kind: 'failed', message: 'The update was installed but the app did not restart. Start it again by hand.' });
    } catch (caught) {
      setState({ kind: 'failed', message: describe(caught) });
    }
  }

  const available =
    state.kind === 'result' && state.check.status === 'available' ? state.check.update : null;

  return (
    <>
      <Row
        label="Updates"
        hint="Checked when the app starts and every few hours after that. An
              update is only ever installed when you say so."
      >
        <Actions>
          {available ? (
            <button type="button" className="set-btn" onClick={() => void install(available)}>
              Install {available.version} and restart
            </button>
          ) : (
            <button
              type="button"
              className="set-btn set-btn--quiet"
              onClick={() => void check()}
              disabled={state.kind === 'checking' || state.kind === 'installing'}
            >
              {state.kind === 'checking' ? 'Checking…' : 'Check now'}
            </button>
          )}
        </Actions>
      </Row>

      {state.kind === 'result' && state.check.status === 'none' && (
        <Note tone="sealed">You have the latest version.</Note>
      )}
      {state.kind === 'result' && state.check.status === 'disabled' && (
        <Note>This is a development build. It never checks for updates.</Note>
      )}
      {state.kind === 'result' && state.check.status === 'error' && (
        <Note tone="warn">Could not check: {state.check.message}</Note>
      )}
      {available && (
        <Note tone="sealed">
          Cipher {available.version} is ready.
          {available.notes ? ` ${available.notes}` : ''}
        </Note>
      )}
      {state.kind === 'installing' && (
        <Note>{describeProgress(state.progress)}</Note>
      )}
      {state.kind === 'failed' && <Note tone="danger">{state.message}</Note>}
    </>
  );
}

/* ---------------------------------------------------------------- window --- */

function CloseToTrayRow() {
  const { settings, update } = useSettings();
  return (
    <Row
      label="Keep running when the window is closed"
      hint="The app stays in the tray, so messages and calls still reach you.
            Off, closing the window quits. Quit from the tray menu either way."
    >
      <Toggle
        label="Keep running when the window is closed"
        checked={settings.desktop.closeToTray}
        onChange={(closeToTray) => update('desktop', { closeToTray })}
      />
    </Row>
  );
}

function AutostartRow() {
  const platform = usePlatform();
  const prefs = platform.prefs!;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    prefs
      .autostartEnabled()
      .then((value) => {
        if (live) setEnabled(value);
      })
      .catch((caught: unknown) => {
        if (live) setError(describe(caught));
      });
    return () => {
      live = false;
    };
  }, [prefs]);

  async function toggle(next: boolean) {
    setError(null);
    try {
      await prefs.setAutostart(next);
      setEnabled(next);
    } catch (caught) {
      setError(describe(caught));
    }
  }

  return (
    <>
      <Row
        label="Start when you sign in to your computer"
        hint="Opens in the tray without showing the window, so you are reachable
              before you have thought about it."
      >
        <Toggle
          label="Start when you sign in to your computer"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={(next) => void toggle(next)}
        />
      </Row>
      {error && <Note tone="danger">{error}</Note>}
    </>
  );
}
