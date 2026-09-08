/**
 * Right-click a person, act on them.
 *
 * One provider rather than a menu per list, because the same actions belong on
 * a conversation row, a friends row, a message author and the profile card, and
 * four copies of them would drift. Anywhere that draws a person calls
 * `usePersonMenu().open(event, userId)` from `onContextMenu` and gets the whole
 * thing; anywhere with its own buttons calls `act(action, userId)` and gets the
 * same dialogs without the menu.
 *
 * Removing and blocking both ask first. Neither is catastrophic, but both are
 * invisible once done: nothing on screen says "you unfriended this person", so
 * a misclick would just look like the app losing someone. Unblocking does not
 * ask, because it only ever gives something back.
 */
import { useCallback, useContext, useMemo, useState, createContext, type ReactNode } from 'react';
import { ContextMenu, MenuDivider, MenuHeading, MenuItem, type MenuAnchor } from './ContextMenu';
import {
  BanIcon,
  MessageIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ProfileIcon,
  UserMinusIcon,
} from './Icons';
import { isPinned, pinnedIsFull, togglePin } from '../lib/settings/pinned';
import { MAX_PINNED } from '../lib/settings/types';
import { useChat } from '../state/ChatProvider';
import { useT } from '../state/I18nProvider';
import { useSettings } from '../state/SettingsProvider';
import '../styles/dialog.css';

export type PersonAction =
  | 'profile'
  | 'message'
  | 'pin'
  | 'nickname'
  | 'clear-nickname'
  | 'unfriend'
  | 'block';

interface PersonMenuValue {
  /** Opens the menu where the pointer is, and stops the browser's own menu. */
  open: (event: React.MouseEvent, userId: string) => void;
  /** Runs one action directly, dialogs included. For buttons, not right-clicks. */
  act: (action: PersonAction, userId: string) => void;
}

const PersonMenuContext = createContext<PersonMenuValue | null>(null);

type Pending =
  | { kind: 'menu'; userId: string; anchor: MenuAnchor }
  | { kind: 'nickname'; userId: string }
  | { kind: 'unfriend'; userId: string }
  | { kind: 'block'; userId: string }
  | null;

export interface PersonMenuProviderProps {
  children: ReactNode;
  /**
   * Opens the profile panel. Optional: where there is nowhere to put a profile
   * (the Friends screen owns its whole pane), the menu simply omits the item
   * rather than offering one that does nothing.
   */
  onViewProfile?: (userId: string) => void;
}

export function PersonMenuProvider({ children, onViewProfile }: PersonMenuProviderProps) {
  const { usersById, friends, self, openDmWith, removeFriend, blockUser, setNickname } = useChat();
  const { settings, update } = useSettings();
  const t = useT();
  const pinned = settings.sidebar.pinned;
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => setPending(null), []);

  /// Every action closes what opened it before it runs, and reports afterwards.
  /// A dialog that stays up while a request is in flight invites a second click
  /// on the same button, and blocking twice is a different outcome from
  /// blocking once.
  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('person.failed'));
    }
  }, [t]);

  const act = useCallback(
    (action: PersonAction, userId: string) => {
      setError(null);
      switch (action) {
        case 'profile':
          setPending(null);
          onViewProfile?.(userId);
          return;
        case 'message':
          void run(() => openDmWith(userId));
          return;
        case 'clear-nickname':
          void run(() => setNickname(userId, ''));
          return;
        case 'pin':
          // Local, so it needs no dialog and cannot fail. Closing first keeps
          // the menu from sitting open over a list that just reordered.
          setPending(null);
          update('sidebar', { pinned: togglePin(settings.sidebar.pinned, userId) });
          return;
        case 'nickname':
        case 'unfriend':
        case 'block':
          setPending({ kind: action, userId });
      }
    },
    [onViewProfile, openDmWith, run, setNickname, settings.sidebar.pinned, update],
  );

  const open = useCallback((event: React.MouseEvent, userId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setError(null);
    setPending({ kind: 'menu', userId, anchor: { x: event.clientX, y: event.clientY } });
  }, []);

  const value = useMemo<PersonMenuValue>(() => ({ open, act }), [open, act]);

  const person = pending ? usersById.get(pending.userId) : undefined;
  const isFriend = pending ? friends.some((friend) => friend.id === pending.userId) : false;
  // Your own row has a menu with nothing on it worth showing, so it has none.
  const isSelf = pending ? pending.userId === self?.id : false;

  return (
    <PersonMenuContext.Provider value={value}>
      {children}

      {pending?.kind === 'menu' && person && !isSelf && (
        <ContextMenu
          anchor={pending.anchor}
          onClose={close}
          label={t('person.actionsFor', { name: person.name })}
        >
          <MenuHeading>{person.username}</MenuHeading>

          {onViewProfile && (
            <MenuItem
              icon={<ProfileIcon size={15} />}
              label={t('person.viewProfile')}
              onClick={() => act('profile', pending.userId)}
            />
          )}

          {isFriend && (
            <MenuItem
              icon={<MessageIcon size={15} />}
              label={t('userProfile.message')}
              onClick={() => act('message', pending.userId)}
            />
          )}

          {/* Shown even when the list is full, disabled and saying why: an
              item that quietly vanished at fifteen would look like a bug. */}
          <MenuItem
            icon={
              isPinned(pinned, pending.userId) ? <PinOffIcon size={15} /> : <PinIcon size={15} />
            }
            label={
              isPinned(pinned, pending.userId)
                ? t('person.unpin')
                : pinnedIsFull(pinned)
                  ? t('person.pinFull', { max: MAX_PINNED })
                  : t('person.pin')
            }
            disabled={!isPinned(pinned, pending.userId) && pinnedIsFull(pinned)}
            onClick={() => act('pin', pending.userId)}
          />

          <MenuItem
            icon={<PencilIcon size={15} />}
            label={t(
              person.nickname ? 'userProfile.changeNickname' : 'userProfile.addNickname',
            )}
            onClick={() => act('nickname', pending.userId)}
          />

          {person.nickname && (
            <MenuItem
              icon={<PencilIcon size={15} />}
              label={t('person.removeNickname')}
              onClick={() => act('clear-nickname', pending.userId)}
            />
          )}

          <MenuDivider />

          {isFriend && (
            <MenuItem
              danger
              icon={<UserMinusIcon size={15} />}
              label={t('userProfile.unfriend')}
              onClick={() => act('unfriend', pending.userId)}
            />
          )}
          <MenuItem
            danger
            icon={<BanIcon size={15} />}
            label={t('userProfile.block')}
            onClick={() => act('block', pending.userId)}
          />
        </ContextMenu>
      )}

      {pending?.kind === 'nickname' && person && (
        <NicknameDialog
          person={person.username}
          current={person.nickname ?? ''}
          onCancel={close}
          onSave={(nickname) => void run(() => setNickname(pending.userId, nickname))}
        />
      )}

      {pending?.kind === 'unfriend' && person && (
        <ConfirmDialog
          title={t('person.unfriendTitle', { name: person.name })}
          body={t('person.unfriendBody')}
          confirmLabel={t('userProfile.unfriend')}
          onCancel={close}
          onConfirm={() => void run(() => removeFriend(pending.userId))}
        />
      )}

      {pending?.kind === 'block' && person && (
        <ConfirmDialog
          title={t('person.blockTitle', { name: person.name })}
          body={t('person.blockBody')}
          confirmLabel={t('userProfile.block')}
          onCancel={close}
          onConfirm={() => void run(() => blockUser(pending.userId))}
        />
      )}

      {error && (
        <ConfirmDialog
          title={t('person.failedTitle')}
          body={error}
          confirmLabel={t('common.close')}
          onCancel={() => setError(null)}
          onConfirm={() => setError(null)}
        />
      )}
    </PersonMenuContext.Provider>
  );
}

export function usePersonMenu(): PersonMenuValue {
  const context = useContext(PersonMenuContext);
  if (!context) throw new Error('usePersonMenu must be used inside a <PersonMenuProvider>');
  return context;
}

/* ----------------------------------------------------------- dialogs ----- */

const NICKNAME_MAX = 32;

function NicknameDialog({
  person,
  current,
  onSave,
  onCancel,
}: {
  person: string;
  current: string;
  onSave: (nickname: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(current);

  return (
    <Dialog onCancel={onCancel} title={t('person.nicknameFor', { name: person })}>
      <p className="dialog__body">{t('person.nicknameBody')}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <input
          className="dialog__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={person}
          maxLength={NICKNAME_MAX}
          autoFocus
          spellCheck={false}
        />

        <div className="dialog__actions">
          <button type="button" className="dialog__button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="dialog__button dialog__button--primary">
            {t(value.trim() ? 'common.save' : 'person.useUsername')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Dialog onCancel={onCancel} title={title}>
      <p className="dialog__body">{body}</p>
      <div className="dialog__actions">
        <button type="button" className="dialog__button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="dialog__button dialog__button--danger"
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  return (
    <div
      className="dialog__scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      {/* The panel swallows the click so only the scrim dismisses. */}
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
