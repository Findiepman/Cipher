/**
 * Right-click a person, act on them.
 *
 * One provider rather than a menu per list, because the same four actions
 * belong on a conversation row, a friends row and a message author, and three
 * copies of them would drift. Anywhere that draws a person calls
 * `usePersonMenu().open(event, userId)` from `onContextMenu` and gets the whole
 * thing.
 *
 * Removing and blocking both ask first. Neither is catastrophic, but both are
 * invisible once done: nothing on screen says "you unfriended this person", so
 * a misclick would just look like the app losing someone.
 */
import { useCallback, useContext, useMemo, useState, createContext, type ReactNode } from 'react';
import { ContextMenu, MenuDivider, MenuHeading, MenuItem, type MenuAnchor } from './ContextMenu';
import { BanIcon, MessageIcon, PencilIcon, UserMinusIcon } from './Icons';
import { useChat } from '../state/ChatProvider';
import '../styles/dialog.css';

interface PersonMenuValue {
  /** Opens the menu where the pointer is, and stops the browser's own menu. */
  open: (event: React.MouseEvent, userId: string) => void;
}

const PersonMenuContext = createContext<PersonMenuValue | null>(null);

type Pending =
  | { kind: 'menu'; userId: string; anchor: MenuAnchor }
  | { kind: 'nickname'; userId: string }
  | { kind: 'remove'; userId: string }
  | { kind: 'block'; userId: string }
  | null;

export function PersonMenuProvider({ children }: { children: ReactNode }) {
  const { usersById, friends, self, openDmWith, removeFriend, blockUser, setNickname } = useChat();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((event: React.MouseEvent, userId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setError(null);
    setPending({ kind: 'menu', userId, anchor: { x: event.clientX, y: event.clientY } });
  }, []);

  const value = useMemo<PersonMenuValue>(() => ({ open }), [open]);

  const person = pending ? usersById.get(pending.userId) : undefined;
  const isFriend = pending ? friends.some((friend) => friend.id === pending.userId) : false;
  // Your own row has a menu with nothing on it worth showing, so it has none.
  const isSelf = pending ? pending.userId === self?.id : false;

  function close() {
    setPending(null);
  }

  /// Every action closes the menu first and reports afterwards. A dialog that
  /// stays open while a request is in flight invites a second click on the same
  /// button, and blocking twice is a different outcome from blocking once.
  async function run(action: () => Promise<void>) {
    close();
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    }
  }

  return (
    <PersonMenuContext.Provider value={value}>
      {children}

      {pending?.kind === 'menu' && person && !isSelf && (
        <ContextMenu anchor={pending.anchor} onClose={close} label={`Actions for ${person.name}`}>
          <MenuHeading>{person.username}</MenuHeading>

          {isFriend && (
            <MenuItem
              icon={<MessageIcon size={15} />}
              label="Message"
              onClick={() => void run(() => openDmWith(pending.userId))}
            />
          )}

          <MenuItem
            icon={<PencilIcon size={15} />}
            label={person.nickname ? 'Change nickname' : 'Add nickname'}
            onClick={() => setPending({ kind: 'nickname', userId: pending.userId })}
          />

          {person.nickname && (
            <MenuItem
              icon={<PencilIcon size={15} />}
              label="Remove nickname"
              onClick={() => void run(() => setNickname(pending.userId, ''))}
            />
          )}

          <MenuDivider />

          {isFriend && (
            <MenuItem
              danger
              icon={<UserMinusIcon size={15} />}
              label="Remove friend"
              onClick={() => setPending({ kind: 'remove', userId: pending.userId })}
            />
          )}
          <MenuItem
            danger
            icon={<BanIcon size={15} />}
            label="Block"
            onClick={() => setPending({ kind: 'block', userId: pending.userId })}
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

      {pending?.kind === 'remove' && person && (
        <ConfirmDialog
          title={`Remove ${person.name}?`}
          body={
            'You will stop being able to send each other anything new. What you ' +
            'have already said stays where it is, and either of you can ask again later.'
          }
          confirmLabel="Remove friend"
          onCancel={close}
          onConfirm={() => void run(() => removeFriend(pending.userId))}
        />
      )}

      {pending?.kind === 'block' && person && (
        <ConfirmDialog
          title={`Block ${person.name}?`}
          body={
            'They will not be able to reach you or add you again, and they are not ' +
            'told. This also ends your friendship. You can undo it later.'
          }
          confirmLabel="Block"
          onCancel={close}
          onConfirm={() => void run(() => blockUser(pending.userId))}
        />
      )}

      {error && (
        <ConfirmDialog
          title="That did not work"
          body={error}
          confirmLabel="Close"
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
  const [value, setValue] = useState(current);

  return (
    <Dialog onCancel={onCancel} title={`Nickname for ${person}`}>
      <p className="dialog__body">
        Only you see this. It replaces their username everywhere in your app, and
        they are never told about it.
      </p>

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
            Cancel
          </button>
          <button type="submit" className="dialog__button dialog__button--primary">
            {value.trim() ? 'Save' : 'Use their username'}
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
  return (
    <Dialog onCancel={onCancel} title={title}>
      <p className="dialog__body">{body}</p>
      <div className="dialog__actions">
        <button type="button" className="dialog__button" onClick={onCancel}>
          Cancel
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
