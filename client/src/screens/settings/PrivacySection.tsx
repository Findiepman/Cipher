/**
 * The things you tell other people without meaning to.
 *
 * Encryption hides what you said. It does not hide that you are typing, that
 * you read something at 03:14, or that you opened a link. Those are the leaks
 * left over once the content is sealed, so they get their own section rather
 * than being buried as niceties in a notifications list.
 */
import { Group, Note, Row, Segmented, Toggle } from '../../components/settings/controls';
import type { DirectMessagePolicy } from '../../lib/settings/types';
import { useSettings } from '../../state/SettingsProvider';

const POLICIES: { value: DirectMessagePolicy; label: string }[] = [
  { value: 'everyone', label: 'Anyone' },
  { value: 'known', label: 'People I know' },
  { value: 'nobody', label: 'No one' },
];

export function PrivacySection() {
  const { settings, update } = useSettings();
  const privacy = settings.privacy;

  return (
    <>
      <Group title="what you reveal">
        <Row
          label="Read receipts"
          hint="Lets the other person see when you have opened their message.
                Turning this off also stops you seeing theirs."
        >
          <Toggle
            label="Read receipts"
            checked={privacy.readReceipts}
            onChange={(readReceipts) => update('privacy', { readReceipts })}
          />
        </Row>

        <Row
          label="Typing indicators"
          hint="Shows the other person that you are writing something, including
                the drafts you delete."
        >
          <Toggle
            label="Typing indicators"
            checked={privacy.typingIndicators}
            onChange={(typingIndicators) => update('privacy', { typingIndicators })}
          />
        </Row>

        <Row
          label="Link previews"
          hint="Fetching a preview tells the linked site that someone opened the
                link, from your address, at that moment. The message stays
                encrypted; the visit is not."
        >
          <Toggle
            label="Link previews"
            checked={privacy.linkPreviews}
            onChange={(linkPreviews) => update('privacy', { linkPreviews })}
          />
        </Row>
      </Group>

      <Group title="who can reach you">
        <Row label="Direct messages from">
          <Segmented
            label="Direct messages from"
            value={privacy.directMessagesFrom}
            options={POLICIES}
            onChange={(directMessagesFrom) => update('privacy', { directMessagesFrom })}
          />
        </Row>
      </Group>

      <Note tone="sealed">
        None of this changes what the server can read, which is nothing. It
        changes what your contacts and the sites you link to can work out.
      </Note>
    </>
  );
}
