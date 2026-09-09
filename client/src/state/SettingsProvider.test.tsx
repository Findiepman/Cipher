// @vitest-environment jsdom
/**
 * What the provider writes onto <html>.
 *
 * This is the whole mechanism behind the theme: the stylesheet has a block per
 * palette and mode, and these attributes are what pick one. A test at this seam
 * is cheaper than a screenshot and catches the two things that actually break,
 * which are an attribute that stops being written and a stored value that
 * reaches the DOM without being checked first.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { saveAs } from '../lib/settings/savedProfiles';
import { SettingsStore, STORAGE_KEY, type SettingsStorage } from '../lib/settings/store';
import { SettingsProvider, useSettings } from './SettingsProvider';

afterEach(cleanup);

function fakeStorage(seed?: string): SettingsStorage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(STORAGE_KEY, seed);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Renders nothing, but gives a test a button that changes one setting. */
function Harness() {
  const { settings, update, resolvedPalette } = useSettings();
  return (
    <button type="button" onClick={() => update('appearance', { palette: 'tide' })}>
      {settings.appearance.theme}/{resolvedPalette}
    </button>
  );
}

function mount(seed?: string) {
  return render(
    <SettingsProvider store={new SettingsStore(fakeStorage(seed))}>
      <Harness />
    </SettingsProvider>,
  );
}

describe('SettingsProvider', () => {
  it('writes the theme and the palette as separate attributes', () => {
    mount(JSON.stringify({ appearance: { theme: 'light', palette: 'orchid' } }));

    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.palette).toBe('orchid');
  });

  it('ignores a stored palette that no stylesheet knows about', () => {
    mount(JSON.stringify({ appearance: { palette: 'chartreuse' } }));

    expect(document.documentElement.dataset.palette).toBe('ember');
    expect(screen.getByRole('button').textContent).toBe('dark/ember');
  });

  it('repaints when the palette changes', () => {
    mount();
    expect(document.documentElement.dataset.palette).toBe('ember');

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.palette).toBe('tide');
  });
});

/**
 * The mirroring is the one part of saved profiles that is not a pure reducer,
 * so it is the part worth a React test: an edit made while a profile is loaded
 * has to land in that profile's slot, or switching away would lose it and the
 * screen would need an unsaved-changes state it deliberately does not have.
 */
function ProfileHarness() {
  const { settings, savedProfiles, update, applyProfiles } = useSettings();
  const loaded = savedProfiles.find((entry) => entry.id === settings.profiles.active);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          applyProfiles(
            saveAs(
              {
                profile: settings.profile,
                profiles: settings.profiles,
                appearance: settings.appearance,
              },
              'day',
            ),
          )
        }
      >
        save
      </button>
      <button type="button" onClick={() => update('profile', { displayName: 'edited' })}>
        edit
      </button>
      <output>
        {settings.profile.displayName}/{loaded?.profile.displayName ?? 'none'}/
        {savedProfiles.length}
      </output>
    </>
  );
}

function mountProfiles(seed?: string) {
  render(
    <SettingsProvider store={new SettingsStore(fakeStorage(seed))}>
      <ProfileHarness />
    </SettingsProvider>,
  );
  return () => screen.getByRole('status').textContent;
}

describe('saved profiles', () => {
  it('mirrors an edit into the profile that is loaded', () => {
    const read = mountProfiles();
    fireEvent.click(screen.getByText('save'));
    // One profile on the shelf and loaded, holding what the live one held,
    // which at this point is the default empty display name.
    expect(read()).toBe('//1');

    fireEvent.click(screen.getByText('edit'));

    // Both the live profile and its slot, from one edit.
    expect(read()).toBe('edited/edited/1');
  });

  it('does not invent a slot when nothing is loaded', () => {
    const read = mountProfiles();

    fireEvent.click(screen.getByText('edit'));

    expect(read()).toBe('edited/none/0');
  });

  it('ignores a stored shelf that is not a list of profiles', () => {
    const read = mountProfiles(
      JSON.stringify({ profiles: { active: 'a', saved: 'not a list' } }),
    );

    expect(read()).toBe('/none/0');
  });
});
