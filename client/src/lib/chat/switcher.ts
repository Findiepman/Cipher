/**
 * What a quick-switcher query matches, and in what order.
 *
 * Pure and separate from the component because ranking is the part that is
 * easy to get subtly wrong and impossible to see in a screenshot: a list that
 * looks fine with four conversations puts the wrong row first with forty, and
 * by then the muscle memory is built.
 *
 * The rules, in order:
 *
 *   1. A name that starts with what you typed beats one that merely contains
 *      it. Typing "sam" should find Sam before Rosamund.
 *   2. Between two of the same kind, the one you spoke to more recently wins,
 *      because a switcher is mostly used to go back somewhere.
 *   3. Conversations outrank friends you have never messaged. Both are
 *      offered, since starting one is the other half of "find or start".
 *
 * Matching ignores case and leading space, and looks at the handle as well as
 * the display name: a nickname you set does not stop you finding someone by
 * the name you first knew them under.
 */

export interface Candidate {
  id: string;
  /** What to show: a display name, or a nickname if one is set. */
  name: string;
  /** The username, matched as well as the name. May be absent for a group. */
  handle?: string;
  /** True for an existing conversation, false for a friend with none yet. */
  existing: boolean;
  /** Sort key for recency. Larger is more recent; 0 for never. */
  lastAt?: number;
}

function rankOf(candidate: Candidate, needle: string): number | null {
  if (!needle) return candidate.existing ? 2 : 1;
  const name = candidate.name.toLowerCase();
  const handle = candidate.handle?.toLowerCase() ?? '';
  if (name.startsWith(needle) || handle.startsWith(needle)) return 3;
  if (name.includes(needle) || handle.includes(needle)) return 2;
  return null;
}

/** The candidates worth showing, best first. */
export function rank(candidates: readonly Candidate[], query: string): Candidate[] {
  const needle = query.trim().toLowerCase();

  return candidates
    .map((candidate) => ({ candidate, score: rankOf(candidate, needle) }))
    .filter((row): row is { candidate: Candidate; score: number } => row.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // An existing conversation beats a friend you have never written to,
      // even when both match equally well.
      if (a.candidate.existing !== b.candidate.existing) {
        return a.candidate.existing ? -1 : 1;
      }
      const recency = (b.candidate.lastAt ?? 0) - (a.candidate.lastAt ?? 0);
      if (recency !== 0) return recency;
      return a.candidate.name.localeCompare(b.candidate.name);
    })
    .map((row) => row.candidate);
}
