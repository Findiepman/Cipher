/**
 * The ranking, which is the half of a switcher that cannot be eyeballed.
 *
 * A list that looks right with four conversations puts the wrong row first
 * with forty, and by then people have built muscle memory on it.
 */
import { describe, expect, it } from 'vitest';
import { rank, type Candidate } from './switcher';

function one(over: Partial<Candidate> = {}): Candidate {
  return { id: over.name ?? 'x', name: 'x', existing: true, ...over };
}

describe('rank', () => {
  it('puts a prefix match above a mere containment', () => {
    const out = rank([one({ name: 'Rosamund' }), one({ name: 'Sam' })], 'sam');
    expect(out.map((c) => c.name)).toEqual(['Sam', 'Rosamund']);
  });

  it('ignores case and surrounding space', () => {
    expect(rank([one({ name: 'Teto' })], '  TET ')).toHaveLength(1);
  });

  it('finds someone by handle as well as by the nickname you gave them', () => {
    const renamed = one({ name: 'flatmate', handle: 'ren' });
    expect(rank([renamed], 'ren')).toHaveLength(1);
    expect(rank([renamed], 'flat')).toHaveLength(1);
  });

  it('drops what does not match at all', () => {
    expect(rank([one({ name: 'Teto' })], 'zzz')).toEqual([]);
  });

  it('prefers a conversation you have over a friend you have never written to', () => {
    const out = rank(
      [one({ id: 'f', name: 'Sam', existing: false }), one({ id: 'c', name: 'Sam' })],
      'sam',
    );
    expect(out.map((c) => c.id)).toEqual(['c', 'f']);
  });

  it('breaks a tie on recency, because a switcher mostly goes back somewhere', () => {
    const out = rank(
      [
        one({ id: 'old', name: 'Sam A', lastAt: 1 }),
        one({ id: 'new', name: 'Sam B', lastAt: 9 }),
      ],
      'sam',
    );
    expect(out.map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('shows everything when nothing is typed, conversations first', () => {
    const out = rank(
      [one({ id: 'f', name: 'B', existing: false }), one({ id: 'c', name: 'A' })],
      '',
    );
    expect(out.map((c) => c.id)).toEqual(['c', 'f']);
  });
});
