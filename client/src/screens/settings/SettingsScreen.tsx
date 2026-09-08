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
import { isDesktop } from '../../lib/config';
import { withProfile } from '../../lib/settings/profile';
import type { Key } from '../../lib/i18n/en';
import { useT } from '../../state/I18nProvider';
import { useSettings } from '../../state/SettingsProvider';
import { useSession } from '../../state/SessionProvider';
import type { User } from '../../types';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { DesktopSection } from './DesktopSection';
import { DevicesSection } from './DevicesSection';
import { LanguageSection } from './LanguageSection';
import { NotificationsSection } from './NotificationsSection';
import { PrivacySection } from './PrivacySection';
import { ProfileSection } from './ProfileSection';
import { VaultSection } from './VaultSection';
import { VoiceVideoSection } from './VoiceVideoSection';
import '../../styles/settings.css';

export type SectionId =
  | 'account'
  | 'profile'
  | 'privacy'
  | 'devices'
  | 'vault'
  | 'language'
  | 'appearance'
  | 'voice'
  | 'notifications'
  | 'desktop';

/**
 * Keys rather than strings, because this list is module-level data and a
 * module is evaluated once, long before anyone has picked a language. The
 * label and the title were always the same string, so there is one key for
 * both.
 */
interface SectionDef {
  id: SectionId;
  name: Key;
  lede: Key;
}

const GROUPS: { heading: Key; sections: SectionDef[] }[] = [
  {
    heading: 'settings.group.you',
    sections: [
      { id: 'account', name: 'settings.section.account', lede: 'settings.lede.account' },
      { id: 'profile', name: 'settings.section.profile', lede: 'settings.lede.profile' },
      { id: 'privacy', name: 'settings.section.privacy', lede: 'settings.lede.privacy' },
      { id: 'devices', name: 'settings.section.devices', lede: 'settings.lede.devices' },
      { id: 'vault', name: 'settings.section.vault', lede: 'settings.lede.vault' },
    ],
  },
  {
    heading: 'settings.group.app',
    sections: [
      { id: 'language', name: 'settings.section.language', lede: 'settings.lede.language' },
      {
        id: 'appearance',
        name: 'settings.section.appearance',
        lede: 'settings.lede.appearance',
      },
      { id: 'voice', name: 'settings.section.voice', lede: 'settings.lede.voice' },
      {
        id: 'notifications',
        name: 'settings.section.notifications',
        lede: 'settings.lede.notifications',
      },
      // Only the desktop app has a shell to hold these. In a browser the
      // entry is simply absent rather than greyed out.
      ...(isDesktop
        ? [
            {
              id: 'desktop' as const,
              name: 'settings.section.desktop' as const,
              lede: 'settings.lede.desktop' as const,
            },
          ]
        : []),
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
  const t = useT();
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
      <nav className="settings__nav" aria-label={t('settings.nav')}>
        <div className="settings__nav-scroll scroller">
          <p className="settings__who">
            <span className="settings__who-name">
              {previewUser.name}
            </span>
            {account && <span className="settings__who-sub">{account.email}</span>}
          </p>

          {GROUPS.map((group) => (
            <div key={group.heading} className="settings__group">
              <span className="eyebrow">{t(group.heading)}</span>
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
                  {t(entry.name)}
                </button>
              ))}
            </div>
          ))}

          {signedIn && (
            <div className="settings__group settings__group--exit">
              <button type="button" className="settings__link" onClick={lock}>
                {t('settings.lock')}
              </button>
              <button
                type="button"
                className="settings__link settings__link--danger"
                onClick={() => void logout()}
              >
                {t('settings.signOut')}
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
              <span>{t('settings.back')}</span>
            </button>

            <button
              type="button"
              className="settings__close"
              onClick={onClose}
              aria-label={t('settings.close')}
            >
              <CloseIcon size={16} />
              <span className="settings__close-key mono">esc</span>
            </button>
          </div>

          <SectionHeader title={t(section.name)} lede={t(section.lede)} />

          {active === 'account' && <AccountSection />}
          {active === 'profile' && (
            <ProfileSection
              user={previewUser}
              fallbackName={account?.username ?? user.name}
            />
          )}
          {active === 'privacy' && <PrivacySection />}
          {active === 'devices' && <DevicesSection />}
          {active === 'vault' && <VaultSection />}
          {active === 'language' && <LanguageSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'voice' && <VoiceVideoSection />}
          {active === 'notifications' && <NotificationsSection />}
          {active === 'desktop' && <DesktopSection />}
        </div>
      </main>
    </div>
  );
}
