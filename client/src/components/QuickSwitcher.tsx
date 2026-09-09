/**
 * Find or start a conversation, from anywhere, without reaching for the list.
 *
 * The list is fine at four conversations and stops being fine at forty, which
 * is the point at which every chat app grows one of these. It offers both
 * halves of the job: the conversations you already have, and the friends you
 * have never written to, because "start one" is the same intent as "go there"
 * and making them two different journeys is what sends people to the Friends
 * tab to do something they were already halfway through.
 *
 * Ctrl+K opens it, which is the shortcut this class of control has settled on
 * everywhere else. Arrow keys move, Enter goes, Escape leaves.
 *
 * Ranking is `lib/chat/switcher.ts`, deliberately elsewhere: it is the half
 * that cannot be checked by looking, and it has tests.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { rank, type Candidate } from '../lib/chat/switcher';
import { useChat } from '../state/ChatProvider';
import { useT } from '../state/I18nProvider';
import type { User } from '../types';
import '../styles/quick-switcher.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function QuickSwitcher({ open, onClose }: Props) {
  const t = useT();
  const { channels, friends, usersById, selectChannel, openDmWith, messagesFor } = useChat();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Everything you could go to. A friend already in a conversation is not
  // offered twice: the conversation is the better of the two rows, since it
  // is the one that can show a preview and carries the history.
  const candidates = useMemo<Candidate[]>(() => {
    const withConversation = new Set<string>();
    const rows: Candidate[] = channels.map((channel) => {
      if (channel.recipientId) withConversation.add(channel.recipientId);
      const person = channel.recipientId ? usersById.get(channel.recipientId) : undefined;
      const last = messagesFor(channel.id).at(-1);
      return {
        id: channel.id,
        name: channel.name,
        handle: person?.username,
        existing: true,
        lastAt: last ? Date.parse(last.sentAt) : 0,
      };
    });

    for (const friend of friends) {
      if (withConversation.has(friend.id)) continue;
      rows.push({
        id: friend.id,
        name: friend.nickname || friend.username,
        handle: friend.username,
        existing: false,
      });
    }
    return rows;
  }, [channels, friends, usersById, messagesFor]);

  const results = useMemo(() => rank(candidates, query).slice(0, 12), [candidates, query]);

  // A fresh query starts at the top; otherwise the cursor can sit past the end
  // of a list that just got shorter.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const go = (candidate: Candidate | undefined) => {
    if (!candidate) return;
    onClose();
    if (candidate.existing) selectChannel(candidate.id);
    else void openDmWith(candidate.id);
  };

  return (
    <>
      <button type="button" className="qs__scrim" aria-label={t('common.close')} onClick={onClose} />

      <div className="qs" role="dialog" aria-label={t('switcher.open')}>
        <input
          ref={input}
          className="qs__input"
          value={query}
          placeholder={t('switcher.placeholder')}
          aria-label={t('switcher.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Enter') go(results[cursor]);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((at) => Math.min(at + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((at) => Math.max(at - 1, 0));
            }
          }}
        />

        <div className="qs__results">
          {results.length === 0 && <p className="qs__empty">{t('switcher.none')}</p>}

          {results.map((candidate, index) => {
            const person = candidate.existing
              ? undefined
              : (usersById.get(candidate.id) as User | undefined);
            return (
              <button
                key={`${candidate.existing ? 'c' : 'f'}:${candidate.id}`}
                type="button"
                className={index === cursor ? 'qs__row qs__row--on' : 'qs__row'}
                // Pointer moves the cursor rather than fighting it, so the
                // keyboard and the mouse never disagree about what Enter does.
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(candidate)}
              >
                {person && <Avatar user={person} size={24} />}
                <span className="qs__name">{candidate.name}</span>
                {candidate.handle && candidate.handle !== candidate.name && (
                  <span className="qs__handle mono">{candidate.handle}</span>
                )}
                {!candidate.existing && (
                  <span className="qs__tag">{t('switcher.start')}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
