/**
 * Theme, colour, layout, spacing, text size.
 *
 * Every control here is live. There is no Apply button, because the app behind
 * the settings panel is the preview. The sample conversation exists for the
 * cases where it is not: on a narrow window the panel covers the chat, and
 * "make the text bigger" is exactly the setting you cannot judge blind.
 */
import {
  ColorField,
  Group,
  Note,
  Row,
  Segmented,
  Slider,
  Toggle,
} from '../../components/settings/controls';
import { PictureField } from '../../components/settings/PictureField';
import { PICTURE_FRAMES } from '../../lib/settings/avatarImage';
import {
  ACTIVITY_BAR_POSITIONS,
  FONT_SCALE_RANGE,
  PALETTES,
  WALLPAPER_BLUR_RANGE,
  WALLPAPER_DIM_RANGE,
  resolveHex,
  type ActivityBarPosition,
  type AppearanceSettings,
  type Density,
  type Palette,
  type ThemeChoice,
} from '../../lib/settings/types';
import type { Key } from '../../lib/i18n/en';
import { useT, type Translate } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

/* Keys, because these are evaluated when the module loads and nobody has
   picked a language yet. The palette names are the exception below. */
const THEMES: { value: ThemeChoice; label: Key }[] = [
  { value: 'dark', label: 'appearance.theme.dark' },
  { value: 'light', label: 'appearance.theme.light' },
  { value: 'system', label: 'appearance.theme.system' },
];

const DENSITIES: { value: Density; label: Key }[] = [
  { value: 'cozy', label: 'appearance.density.cozy' },
  { value: 'compact', label: 'appearance.density.compact' },
];

/**
 * Palette names are not translated, and that is deliberate. They are names,
 * the way a paint chart has names: "Ember" is what this colour is called, and
 * translating it would make the same colour a different thing in every
 * language for no gain. The swatch is doing the explaining anyway.
 */
const PALETTE_LABELS: Record<(typeof PALETTES)[number], string> = {
  ember: 'Ember',
  tide: 'Tide',
  orchid: 'Orchid',
  rose: 'Rose',
  slate: 'Slate',
};

const BAR_LABELS: Record<ActivityBarPosition, Key> = {
  top: 'appearance.bar.top',
  left: 'appearance.bar.left',
  right: 'appearance.bar.right',
  bottom: 'appearance.bar.bottom',
};

export function AppearanceSection() {
  const { settings, update, resolvedTheme, resolvedPalette } = useSettings();
  const t = useT();
  const appearance = settings.appearance;
  const themes = THEMES.map((one) => ({ ...one, label: t(one.label) }));
  const densities = DENSITIES.map((one) => ({ ...one, label: t(one.label) }));

  return (
    <>
      <Group title={t('appearance.group.theme')} hint={t('appearance.group.themeHint')}>
        <Row
          label={t('appearance.mode')}
          hint={
            appearance.theme === 'system'
              ? t('appearance.modeFollowing', {
                  mode: t(
                    resolvedTheme === 'dark'
                      ? 'appearance.theme.dark'
                      : 'appearance.theme.light',
                  ).toLocaleLowerCase(),
                })
              : t('appearance.modeHint')
          }
        >
          <Segmented
            label={t('appearance.mode')}
            value={appearance.theme}
            options={themes}
            onChange={(theme) => update('appearance', { theme })}
          />
        </Row>

        <Row
          label={t('appearance.palette')}
          hint={t('appearance.paletteHint')}
          stacked
        >
          <PaletteChoice
            value={resolvedPalette}
            theme={resolvedTheme}
            t={t}
            onChange={(palette) => update('appearance', { palette })}
          />
        </Row>

        {/* Only while it is the one in use. Two colour pickers under a palette
            you are not wearing would be a control with nothing to point at. */}
        {resolvedPalette === 'custom' && (
          <CustomPalette
            appearance={appearance}
            t={t}
            onChange={(values) => update('appearance', values)}
          />
        )}
      </Group>

      <Group title={t('appearance.group.wallpaper')} hint={t('appearance.group.wallpaperHint')}>
        <PictureField
          label={t('appearance.wallpaper')}
          hint={t('appearance.wallpaperHint')}
          value={appearance.wallpaper}
          frame={PICTURE_FRAMES.wallpaper}
          title="crop.wallpaperTitle"
          body="crop.wallpaperBody"
          onChange={(wallpaper) => update('appearance', { wallpaper })}
        />

        {appearance.wallpaper && (
          <>
            <Row label={t('appearance.dim')} hint={t('appearance.dimHint')}>
              <Slider
                label={t('appearance.dim')}
                value={appearance.wallpaperDim}
                min={WALLPAPER_DIM_RANGE.min}
                max={WALLPAPER_DIM_RANGE.max}
                step={WALLPAPER_DIM_RANGE.step}
                onChange={(wallpaperDim) => update('appearance', { wallpaperDim })}
                format={(value) => `${value}%`}
              />
            </Row>

            <Row label={t('appearance.blur')} hint={t('appearance.blurHint')}>
              <Slider
                label={t('appearance.blur')}
                value={appearance.wallpaperBlur}
                min={WALLPAPER_BLUR_RANGE.min}
                max={WALLPAPER_BLUR_RANGE.max}
                step={WALLPAPER_BLUR_RANGE.step}
                onChange={(wallpaperBlur) => update('appearance', { wallpaperBlur })}
                format={(value) => `${value}px`}
              />
            </Row>
          </>
        )}
      </Group>

      <Group title={t('appearance.group.layout')}>
        <Row
          label={t('appearance.bar')}
          hint={t('appearance.barHint')}
          stacked
        >
          <BarChoice
            value={appearance.activityBar}
            t={t}
            onChange={(activityBar) => update('appearance', { activityBar })}
          />
        </Row>

        <div className="set-phone-only">
          <Note>{t('appearance.barPhone')}</Note>
        </div>
      </Group>

      <Group title={t('appearance.group.messages')}>
        <Row label={t('appearance.spacing')} hint={t('appearance.spacingHint')}>
          <Segmented
            label={t('appearance.spacing')}
            value={appearance.density}
            options={densities}
            onChange={(density) => update('appearance', { density })}
          />
        </Row>

        <Row label={t('appearance.textSize')} hint={t('appearance.textSizeHint')}>
          <Slider
            label={t('appearance.textSize')}
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

      <Group title={t('appearance.group.motion')}>
        <Row label={t('appearance.reduceMotion')} hint={t('appearance.reduceMotionHint')}>
          <Toggle
            label={t('appearance.reduceMotion')}
            checked={appearance.reduceMotion}
            onChange={(reduceMotion) => update('appearance', { reduceMotion })}
          />
        </Row>
      </Group>

      <Group title={t('appearance.group.advanced')}>
        <Row
          label={t('appearance.ciphertext')}
          hint={t('appearance.ciphertextHint')}
        >
          <Toggle
            label={t('appearance.ciphertext')}
            checked={appearance.showCiphertext}
            onChange={(showCiphertext) => update('appearance', { showCiphertext })}
          />
        </Row>
      </Group>

      <Note>{t('appearance.note')}</Note>
    </>
  );
}

/**
 * The palettes, each swatch painted in the palette it is offering.
 *
 * The chip carries data-palette and data-theme, which is all theme.css needs to
 * hand it that palette's tokens, so a swatch is a small copy of the real app
 * (backdrop, a panel floating on it, the accent) rather than a list of hex
 * values kept in step with the stylesheet by hand.
 */
function PaletteChoice({
  value,
  theme,
  t,
  onChange,
}: {
  value: Palette;
  theme: 'dark' | 'light';
  t: Translate;
  onChange: (next: Palette) => void;
}) {
  return (
    <div className="set-palettes" role="radiogroup" aria-label={t('appearance.palette')}>
      {PALETTES.map((palette) => (
        <button
          key={palette}
          type="button"
          role="radio"
          aria-checked={palette === value}
          className={palette === value ? 'set-palette set-palette--on' : 'set-palette'}
          onClick={() => onChange(palette)}
        >
          <span className="set-palette__chip" data-palette={palette} data-theme={theme}>
            <span className="set-palette__panel" />
            <span className="set-palette__dot" />
          </span>
          <span className="set-palette__name">{PALETTE_LABELS[palette]}</span>
        </button>
      ))}

      {/* The custom chip is drawn by the same rules as the rest: it carries
          data-palette="custom" and reads the two variables already on <html>,
          so it is a live preview of your colours rather than a swatch that
          only becomes true once you click it. */}
      <button
        type="button"
        role="radio"
        aria-checked={value === 'custom'}
        className={value === 'custom' ? 'set-palette set-palette--on' : 'set-palette'}
        onClick={() => onChange('custom')}
      >
        <span className="set-palette__chip" data-palette="custom" data-theme={theme}>
          <span className="set-palette__panel" />
          <span className="set-palette__dot" />
        </span>
        <span className="set-palette__name">{t('appearance.custom')}</span>
      </button>
    </div>
  );
}

/**
 * The custom palette: two colours, and everything else mixed out of them.
 *
 * Two rather than twenty on purpose. A stylesheet with every token exposed is
 * how a theme ends up with unreadable text on one screen nobody checked, and
 * this app has a rule that panels float on a ground darker than they are. The
 * accent is the interactive colour and the tint is the hue the greys lean
 * towards; theme.css mixes the rest so that rule survives whatever you pick.
 */
function CustomPalette({
  appearance,
  t,
  onChange,
}: {
  appearance: AppearanceSettings;
  t: Translate;
  onChange: (values: Partial<AppearanceSettings>) => void;
}) {
  return (
    <>
      <ColorField
        label={t('appearance.customAccent')}
        hint={t('appearance.customAccentHint')}
        value={resolveHex(appearance.customAccent, '#f2734e')}
        onChange={(customAccent) => onChange({ customAccent })}
      />
      <ColorField
        label={t('appearance.customTint')}
        hint={t('appearance.customTintHint')}
        value={resolveHex(appearance.customTint, '#6b4a3a')}
        onChange={(customTint) => onChange({ customTint })}
      />
    </>
  );
}

/** The four edges, drawn rather than named: the picture is the whole setting. */
function BarChoice({
  value,
  t,
  onChange,
}: {
  value: ActivityBarPosition;
  t: Translate;
  onChange: (next: ActivityBarPosition) => void;
}) {
  return (
    <div className="set-bars" role="radiogroup" aria-label={t('appearance.bar')}>
      {ACTIVITY_BAR_POSITIONS.map((position) => (
        <button
          key={position}
          type="button"
          role="radio"
          aria-checked={position === value}
          className={position === value ? 'set-bar set-bar--on' : 'set-bar'}
          onClick={() => onChange(position)}
        >
          <span className="set-bar__frame" data-bar={position}>
            <span className="set-bar__strip" />
            <span className="set-bar__body" />
          </span>
          <span className="set-bar__name">{t(BAR_LABELS[position])}</span>
        </button>
      ))}
    </div>
  );
}

/** A conversation two turns long, rendered by the same rules as the real one. */
function Preview() {
  const t = useT();
  return (
    <div className="set-chat-preview">
      <div className="message message--run-end">
        <span className="set-chat-preview__avatar">N</span>
        <div className="message__column">
          <span className="message__author">
            nova <span className="message__key mono">4f2a</span>
          </span>
          <div className="bubble bubble--in bubble--tail-in">
            <span className="bubble__body">{t('appearance.previewIn')}</span>
            <span className="bubble__meta mono">12:04</span>
          </div>
        </div>
      </div>

      <div className="message message--own message--run-end">
        <div className="message__column">
          <div className="bubble bubble--out bubble--tail-out">
            <span className="bubble__body">{t('appearance.previewOut')}</span>
            <span className="bubble__meta mono">12:05</span>
          </div>
        </div>
      </div>
    </div>
  );
}
