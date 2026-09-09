/**
 * The whole profile card for one person, fetched when a card is opened.
 *
 * Everything a list needs (name, picture, colour, about) comes down with the
 * friend list, so this exists for the one field that does not: the banner,
 * which is the largest thing a profile holds and only ever drawn here. It is
 * fetched once per (person, version) and kept for the life of the page, so
 * flicking between two friends' cards costs two requests, not one per click.
 * The version is `profileUpdatedAt` from the list, which is what makes an
 * edit on their side show up here without anyone clearing anything.
 *
 * A failed fetch is not an error worth showing. The card still has the
 * colour band and everything else the list already knew.
 */
import { useEffect, useState } from 'react';
import { usersApi } from '../lib/api';
import type { FullProfileDto } from '../lib/api/types';

/** In memory for the page. Keyed on the id and the version together. */
const cache = new Map<string, FullProfileDto>();

/**
 * Requests still out, so two mounts of the same card (StrictMode does this
 * on purpose, two panels could do it by accident) share one round trip.
 */
const pending = new Map<string, Promise<FullProfileDto>>();

function keyFor(userId: string, version: string | undefined): string {
  return `${userId}@${version ?? ''}`;
}

/** For tests, which would otherwise see one another's cards. */
export function forgetProfiles(): void {
  cache.clear();
  pending.clear();
}

function load(
  key: string,
  userId: string,
  fetcher: (userId: string) => Promise<FullProfileDto>,
): Promise<FullProfileDto> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = fetcher(userId)
    .then((fetched) => {
      cache.set(key, fetched);
      return fetched;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, request);
  return request;
}

export function useFullProfile(
  userId: string,
  version: string | undefined,
  fetcher: (userId: string) => Promise<FullProfileDto> = usersApi.profile,
): FullProfileDto | null {
  const key = keyFor(userId, version);
  const [profile, setProfile] = useState<FullProfileDto | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const held = cache.get(key);
    if (held) {
      setProfile(held);
      return;
    }
    // Cleared while the fetch is out, or the previous person's banner would
    // sit under the new person's name until theirs arrives.
    setProfile(null);

    let live = true;
    load(key, userId, fetcher)
      .then((fetched) => {
        if (live) setProfile(fetched);
      })
      .catch(() => {
        // The list already drew what it could.
      });
    return () => {
      live = false;
    };
  }, [key, userId, fetcher]);

  return profile;
}
