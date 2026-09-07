/**
 * Settings takes over the window.
 *
 * A full-screen surface rather than a dialog floating over the chat, for the
 * same reason Discord does it: half of what is in here is a form you should
 * finish before going back to talking, and a modal the size of a settings
 * screen is a full-screen surface that has to explain itself.
 *
 * The list on the left is a page navigation, not a set of tabs: each entry is
 * a section of one screen, sections carry their own state and switching keeps
 * nothing from the one you left.
 *
 * On a narrow window the two panes become two screens: the list, then the
 * section, with a back arrow between them. That is what makes this usable on a
 * phone-sized window, where a sidebar and a content pane side by side would
 * leave neither one wide enough to use.
 */
import { useEffect, useState } from 'react';
import { SectionHeader } from '../../components/settings/controls';
import { CloseIcon, ChevronLeftIcon } from '../../components/Icons';
import { withProfile } from '../../lib/settings/profile';
import { useSettings } from '../../state/SettingsProvider';
import { useSession } from '../../state/SessionProvider';
import type { User } from '../../types';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { DevicesSection } from './DevicesSection';
import { NotificationsSection } from './NotificationsSection';
import { PrivacySection } from './PrivacySection';
import { ProfileSection } from './ProfileSection';
import { VoiceVideoSection } from './VoiceVideoSection';
import '../../styles/settings.css';

export type SectionId =
  | 'account'
  | 'profile'
  | 'privacy'
  | 'devices'
  | 'appearance'
  | 'voice'
  | 'notifications';

interface SectionDef {
  id: SectionId;
  label: string;
  title: string;
  lede: string;
}

const GROUPS: { heading: string; sections: SectionDef[] }[] = [
  {
    heading: 'you',
    sections: [
      {
        id: 'account',
        label: 'My account',
        title: 'My account',
        lede: 'Your credentials, and the two of them that can only be changed from a device holding your key.',
      },
      {
        id: 'profile',
        label: 'Profile',
        title: 'Profile',
        lede: 'The picture, the name and the line under it.',
      },
      {
        id: 'privacy',
        label: 'Privacy',
        title: 'Privacy',
        lede: 'What people can tell about you once the messages themselves are sealed.',
      },
      {
        id: 'devices',
        label: 'Devices & keys',
        title: 'Devices & keys',
        lede: 'Your security number, your recovery code and everywhere you are signed in.',
      },
    ],
  },
  {
    heading: 'app',
    sections: [
      {
        id: 'appearance',
        label: 'Appearance',
        title: 'Appearance',
        lede: 'How the app looks and how much room it gives a conversation.',
      },
      {
        id: 'voice',
        label: 'Voice & video',
        title: 'Voice & video',
        lede: 'Which hardware a call would use, and a way to check it works before one starts.',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        title: 'Notifications',
        lede: 'What interrupts you, and how much of a message it is allowed to show.',
      },
    ],
  },
];

const ALL = GROUPS.flatMap((group) => group.sections);

export function SettingsScreen({
  user,
  onClose,
  initialSection = 'account',
}: {
  /** The signed-in user as the rest of the app renders them. */
  user: User;
  onClose: () => void;
  initialSection?: SectionId;
}) {
  const [active, setActive] = useState<SectionId>(initialSection);
  // Only meaningful on a narrow window, where the two panes are two screens.
  const [showingList, setShowingList] = useState(false);
  const { settings } = useSettings();
  const { account, lock, logout, status } = useSession();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const section = ALL.find((entry) => entry.id === active) ?? ALL[0];
  // The card at the top of the profile section should show the choices being
  // made underneath it, not the stale user the app was handed.
  const previewUser = withProfile(user, settings.profile);
  const signedIn = status === 'authenticated' || status === 'locked';

  return (
    <div className="settings" data-pane={showingList ? 'list' : 'section'}>
      <nav className="settings__nav" aria-label="Settings sections">
        <div className="settings__nav-scroll scroller">
          <p className="settings__who">
            <span className="settings__who-name">
              {previewUser.name}
            </span>
            {account && <span className="settings__who-sub">{account.email}</span>}
          </p>

          {GROUPS.map((group) => (
            <div key={group.heading} className="settings__group">
              <span className="eyebrow">{group.heading}</span>
              {group.sections.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={
                    entry.id === active
                      ? 'settings__link settings__link--active'
                      : 'settings__link'
                  }
                  aria-current={entry.id === active || undefined}
                  onClick={() => {
                    setActive(entry.id);
                    setShowingList(false);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ))}

          {signedIn && (
            <div className="settings__group settings__group--exit">
              <button type="button" className="settings__link" onClick={lock}>
                Lock
              </button>
              <button
                type="button"
                className="settings__link settings__link--danger"
                onClick={() => void logout()}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="settings__pane scroller">
        <div className="settings__pane-inner">
          <div className="settings__topline">
            <button
              type="button"
              className="settings__back"
              onClick={() => setShowingList(true)}
            >
              <ChevronLeftIcon size={16} />
              <span>Settings</span>
            </button>

            <button
              type="button"
              className="settings__close"
              onClick={onClose}
              aria-label="Close settings"
            >
              <CloseIcon size={16} />
              <span className="settings__close-key mono">esc</span>
            </button>
          </div>

          <SectionHeader title={section.title} lede={section.lede} />

          {active === 'account' && <AccountSection />}
          {active === 'profile' && (
            <ProfileSection
              user={previewUser}
              fallbackName={account?.username ?? user.name}
            />
          )}
          {active === 'privacy' && <PrivacySection />}
          {active === 'devices' && <DevicesSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'voice' && <VoiceVideoSection />}
          {active === 'notifications' && <NotificationsSection />}
        </div>
      </main>
    </div>
  );
}
