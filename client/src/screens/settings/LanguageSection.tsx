/**
 * Picking a language.
 *
 * Each choice is written in its own language, because someone looking for
 * Dutch is looking for "Nederlands" and not for "Dutch". The English name sits
 * under it in smaller type, which is what makes this screen escapable if you
 * land on a language you cannot read.
 *
 * "Match my browser" is the default and says which language that currently
 * works out to, so the row is a statement rather than a guess.
 */
import { Group, Note, Row } from '../../components/settings/controls';
import {
  LOCALES,
  LOCALE_INFO,
  localeFromBrowser,
  resolveLanguage,
  type LanguageChoice,
} from '../../lib/i18n/locales';
import { useI18n, useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

export function LanguageSection() {
  const { settings, update } = useSettings();
  const { locale } = useI18n();
  const t = useT();
  const choice = resolveLanguage(settings.language.choice);

  const browser =
    typeof navigator === 'undefined'
      ? LOCALE_INFO.en
      : LOCALE_INFO[localeFromBrowser(navigator.languages ?? [navigator.language])];

  const options: { value: LanguageChoice; name: string; under: string }[] = [
    {
      value: 'system',
      name: t('language.system'),
      under: t('language.systemHint', { name: browser.name }),
    },
    ...LOCALES.map((value) => ({
      value: value as LanguageChoice,
      name: LOCALE_INFO[value].name,
      // The English name is redundant for English and would read as a stutter.
      under: value === 'en' ? '' : LOCALE_INFO[value].english,
    })),
  ];

  return (
    <>
      <Group title={t('language.group')}>
        <Row label={t('language.pick')} hint={t('language.pickHint')} stacked>
          <div className="set-langs" role="radiogroup" aria-label={t('language.pick')}>
            {options.map((option) => {
              const on = option.value === choice;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={on ? 'set-lang set-lang--on' : 'set-lang'}
                  // `lang` on the option itself, so a browser reading this
                  // aloud says "Nederlands" in Dutch instead of in English.
                  lang={option.value === 'system' ? locale : option.value}
                  onClick={() => update('language', { choice: option.value })}
                >
                  <span className="set-lang__name">{option.name}</span>
                  {option.under && <span className="set-lang__under">{option.under}</span>}
                </button>
              );
            })}
          </div>
        </Row>
      </Group>

      <Note>{t('language.note')}</Note>
    </>
  );
}
