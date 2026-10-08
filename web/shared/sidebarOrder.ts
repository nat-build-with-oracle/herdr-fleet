/**
 * The herdr sidebar's order, so the web lists things the way herdr does.
 *
 * herdr numbers every open space by its position in the sidebar. A repo sits
 * where its first open space sits; under it, the repo's own checkout comes
 * first (the sidebar draws it as the header line), then its worktrees in space
 * order. Everything with no open space follows, in the order the scan found it
 * -- a stable sort, so that order is kept rather than reshuffled.
 */
const LAST = Number.POSITIVE_INFINITY;

export type Orderable = { spaceNumber?: number };

export function bySpace<T extends Orderable>(a: T, b: T): number {
  return (a.spaceNumber ?? LAST) - (b.spaceNumber ?? LAST);
}

/** The lowest space number in a group -- where the group sits in the sidebar. */
export function groupPosition<T extends Orderable>(items: T[]): number {
  return items.reduce((min, i) => Math.min(min, i.spaceNumber ?? LAST), LAST);
}
