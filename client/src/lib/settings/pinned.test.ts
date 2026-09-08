/**
 * Pinning, which is one array and three rules that are easy to get wrong:
 * pinned rows are ordered by when they were pinned and not by when anyone last
 * spoke, a pin that no longer matches a conversation is not a row, and a full
 * list refuses rather than evicting.
 */
import { describe, expect, it } from 'vitest';
import { isPinned, pinnedIsFull, splitPinned, togglePin } from './pinned';
import { MAX_PINNED } from './types';

type Row = { id: string; who?: string };

const rows: Row[] = [
  { id: 'c1', who: 'ren' },
  { id: 'c2', who: 'nova' },
  { id: 'c3', who: 'kestrel' },
  { id: 'c4' }, // A group, with nobody to pin.
];

const whoOf = (row: Row) => row.who;

describe('togglePin', () => {
  it('adds somebody who is not on the list, newest last', () => {
    expect(togglePin(['ren'], 'nova')).toEqual(['ren', 'nova']);
  });

  it('removes somebody who is', () => {
    expect(togglePin(['ren', 'nova'], 'ren')).toEqual(['nova']);
  });

  it('refuses a new pin once the list is full, rather than evicting one', () => {
    const full = Array.from({ length: MAX_PINNED }, (_, index) => `p${index}`);
    expect(pinnedIsFull(full)).toBe(true);
    expect(togglePin(full, 'nova')).toEqual(full);
    // Unpinning still works at the limit, which is how you make room.
    expect(togglePin(full, 'p0')).toHaveLength(MAX_PINNED - 1);
  });

  it('drops anything in storage that is not an id, on the way through', () => {
    const stored = ['ren', '', 'ren', 'nova'] as string[];
    expect(togglePin(stored, 'kestrel')).toEqual(['ren', 'nova', 'kestrel']);
  });
});

describe('isPinned', () => {
  it('answers for a person on the list and one who is not', () => {
    expect(isPinned(['ren'], 'ren')).toBe(true);
    expect(isPinned(['ren'], 'nova')).toBe(false);
  });
});

describe('splitPinned', () => {
  it('orders the pinned rows by when they were pinned, not by the list order', () => {
    // kestrel was pinned first, so it leads, even though its conversation is
    // last in the list the server sent.
    const split = splitPinned(rows, ['kestrel', 'ren'], whoOf);
    expect(split.pinned.map((row) => row.id)).toEqual(['c3', 'c1']);
  });

  it('leaves everything else in the order it arrived in', () => {
    const split = splitPinned(rows, ['kestrel'], whoOf);
    expect(split.rest.map((row) => row.id)).toEqual(['c1', 'c2', 'c4']);
  });

  it('ignores a pin with no conversation behind it', () => {
    const split = splitPinned(rows, ['nobody', 'ren'], whoOf);
    expect(split.pinned.map((row) => row.id)).toEqual(['c1']);
    expect(split.rest).toHaveLength(3);
  });

  it('keeps a row with nobody to pin out of the pinned section', () => {
    const split = splitPinned(rows, ['ren', 'nova', 'kestrel'], whoOf);
    expect(split.rest.map((row) => row.id)).toEqual(['c4']);
  });

  it('is every row and no row twice, whatever is pinned', () => {
    const split = splitPinned(rows, ['nova', 'ren'], whoOf);
    expect([...split.pinned, ...split.rest]).toHaveLength(rows.length);
  });
});
