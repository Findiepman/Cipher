/**
 * The things you tell other people without meaning to.
 *
 * Encryption hides what you said. It does not hide that you are typing or
 * that you read something at 03:14. Those are the leaks left over once the
 * content is sealed, so they get their own section rather than being buried
 * as niceties in a notifications list.
 *
 * Two of the three controls are kept on the server, because the server is
 * the only party that can honour them: it is what relays your read position
 * to the other person, and it is where a stranger's friend request lands.
 * The typing one stays local, since a signal this device never sends cannot
 * be relayed. Which is which is written on each row.
 */
import { Group, Note, Row, Segmented, Toggle } from '../../components/settings/controls';
import type { Key } from '../../lib/i18n/en';
import type { FriendRequestPolicy } from '../../lib/settings/types';
import { useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';

/* Keys, not words: this is module-level data, evaluated long before anyone has
   picked a language. Every list of options in the app is written this way. */
const POLICIES: { value: FriendRequestPolicy; label: Key }[] = [
  { value: 'everyone', label: 'privacy.requests.everyone' },
  { value: 'friends_of_friends', label: 'privacy.requests.friendsOfFriends' },
  { value: 'nobody', label: 'privacy.requests.nobody' },
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
      </Group>

      <Group title={t('privacy.group.reach')}>
        <Row label={t('privacy.requestsFrom')} hint={t('privacy.requestsHint')}>
          <Segmented
            label={t('privacy.requestsFrom')}
            value={privacy.friendRequestsFrom}
            options={policies}
            onChange={(friendRequestsFrom) => update('privacy', { friendRequestsFrom })}
          />
        </Row>
      </Group>

      <Note tone="sealed">{t('privacy.note')}</Note>
    </>
  );
}
