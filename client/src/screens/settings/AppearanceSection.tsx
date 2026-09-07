/**
 * Theme, spacing, text size.
 *
 * Every control here is live — there is no Apply button, because the app behind
 * the settings panel is the preview. The sample conversation exists for the
 * cases where it is not: on a narrow window the panel covers the chat, and
 * "make the text bigger" is exactly the setting you cannot judge blind.
 */
import { Group, Note, Row, Segmented, Slider, Toggle } from '../../components/settings/controls';
import { FONT_SCALE_RANGE, type Density, type ThemeChoice } from '../../lib/settings/types';
import { useSettings } from '../../state/SettingsProvider';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'cozy', label: 'Cozy' },
  { value: 'compact', label: 'Compact' },
];

export function AppearanceSection() {
  const { settings, update, resolvedTheme } = useSettings();
  const appearance = settings.appearance;

  return (
    <>
      <Group title="theme">
        <Row
          label="Colour"
          hint={
            appearance.theme === 'system'
              ? `Following this device, which is currently ${resolvedTheme}.`
              : 'Applies immediately, everywhere.'
          }
        >
          <Segmented
            label="Theme"
            value={appearance.theme}
            options={THEMES}
            onChange={(theme) => update('appearance', { theme })}
          />
        </Row>
      </Group>

      <Group title="messages">
        <Row label="Spacing" hint="How much room a conversation gives each turn.">
          <Segmented
            label="Spacing"
            value={appearance.density}
            options={DENSITIES}
            onChange={(density) => update('appearance', { density })}
          />
        </Row>

        <Row label="Text size" hint="Message text only. The rest of the app stays put.">
          <Slider
            label="Text size"
            value={appearance.fontScale}
            min={FONT_SCALE_RANGE.min}
            max={FONT_SCALE_RANGE.max}
            step={FONT_SCALE_RANGE.step}
            onChange={(fontScale) => update('appearance', { fontScale })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        </Row>

        <Preview />
      </Group>

      <Group title="motion">
        <Row
          label="Reduce motion"
          hint="Cuts transitions and animations across the app."
        >
          <Toggle
            label="Reduce motion"
            checked={appearance.reduceMotion}
            onChange={(reduceMotion) => update('appearance', { reduceMotion })}
          />
        </Row>
      </Group>

      <Group title="advanced">
        <Row
          label="Show ciphertext"
          hint="Prints the sealed bytes under every message, as the server stores
                them. Useful for seeing that encryption is really happening;
                noisy for actually reading anything."
        >
          <Toggle
            label="Show ciphertext"
            checked={appearance.showCiphertext}
            onChange={(showCiphertext) => update('appearance', { showCiphertext })}
          />
        </Row>
      </Group>

      <Note>
        Appearance is stored on this device. Signing in somewhere else starts
        from the defaults there.
      </Note>
    </>
  );
}

/** A conversation two turns long, rendered by the same rules as the real one. */
function Preview() {
  return (
    <div className="set-chat-preview">
      <div className="message message--run-end">
        <span className="set-chat-preview__avatar">N</span>
        <div className="message__column">
          <span className="message__author">
            nova <span className="message__key mono">4f2a</span>
          </span>
          <div className="bubble bubble--in bubble--tail-in">
            <span className="bubble__body">Did the new key land on your side?</span>
            <span className="bubble__meta mono">12:04</span>
          </div>
        </div>
      </div>

      <div className="message message--own message--run-end">
        <div className="message__column">
          <div className="bubble bubble--out bubble--tail-out">
            <span className="bubble__body">Same number as yours. We are good.</span>
            <span className="bubble__meta mono">12:05</span>
          </div>
        </div>
      </div>
    </div>
  );
}
