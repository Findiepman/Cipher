/**
 * The things you tell other people without meaning to.
 *
 * Encryption hides what you said. It does not hide that you are typing, that
 * you read something at 03:14, or that you opened a link. Those are the leaks
 * left over once the content is sealed, so they get their own section rather
 * than being buried as niceties in a notifications list.
 */
import { Group, Note, Row, Segmented, Toggle } from '../../components/settings/controls';
import type { Key } from '../../lib/i18n/en';
import type { DirectMessagePolicy } from '../../lib/settings/types';
import { useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

/* Keys, not words: this is module-level data, evaluated long before anyone has
   picked a language. Every list of options in the app is written this way. */
const POLICIES: { value: DirectMessagePolicy; label: Key }[] = [
  { value: 'everyone', label: 'privacy.dm.everyone' },
  { value: 'known', label: 'privacy.dm.known' },
  { value: 'nobody', label: 'privacy.dm.nobody' },
];

export function PrivacySection() {
  const { settings, update } = useSettings();
  const t = useT();
  const privacy = settings.privacy;
  const policies = POLICIES.map((policy) => ({ ...policy, label: t(policy.label) }));

  return (
    <>
      <Group title={t('privacy.group.reveal')}>
        <Row
          label={t('privacy.readReceipts')}
          hint={t('privacy.readReceiptsHint')}
        >
          <Toggle
            label={t('privacy.readReceipts')}
            checked={privacy.readReceipts}
            onChange={(readReceipts) => update('privacy', { readReceipts })}
          />
        </Row>

        <Row
          label={t('privacy.typing')}
          hint={t('privacy.typingHint')}
        >
          <Toggle
            label={t('privacy.typing')}
            checked={privacy.typingIndicators}
            onChange={(typingIndicators) => update('privacy', { typingIndicators })}
          />
        </Row>

        <Row
          label={t('privacy.linkPreviews')}
          hint={t('privacy.linkPreviewsHint')}
        >
          <Toggle
            label={t('privacy.linkPreviews')}
            checked={privacy.linkPreviews}
            onChange={(linkPreviews) => update('privacy', { linkPreviews })}
          />
        </Row>
      </Group>

      <Group title={t('privacy.group.reach')}>
        <Row label={t('privacy.dmFrom')}>
          <Segmented
            label={t('privacy.dmFrom')}
            value={privacy.directMessagesFrom}
            options={policies}
            onChange={(directMessagesFrom) => update('privacy', { directMessagesFrom })}
          />
        </Row>
      </Group>

      <Note tone="sealed">{t('privacy.note')}</Note>
    </>
  );
}
