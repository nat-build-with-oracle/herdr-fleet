/**
 * How much of the fleet to show: what is live, what was worked on lately, or
 * everything.
 *
 * "live" is honest on both machines -- running and open come from each host's
 * own agent and pane lists. "recent" is not symmetric: it needs a transcript
 * mtime, and a remote's transcripts are on its own disk, so a remote row can
 * only qualify by being live. A worktree that someone used on that machine an
 * hour ago and then closed is invisible to this host, and no filter here can
 * conjure it. That asymmetry is stated on the page rather than hidden.
 */
import type { Row, SideInfo } from "./types";

export type Scope = "live" | "recent" | "all";

export const SCOPES: Scope[] = ["live", "recent", "all"];

/** What counts as "recently". A working day, so yesterday evening still shows. */
export const RECENT_MS = 24 * 60 * 60 * 1000;

export const SCOPE_HINT: Record<Scope, string> = {
  live: "a Claude is running, or a herdr space is open",
  recent: "live, or a transcript touched in the last 24h (local side only)",
  all: "every worktree on either machine",
};

const isLive = (s: SideInfo) => s.state === "running" || s.state === "open";

const isRecent = (s: SideInfo, now: number) =>
  isLive(s) || (s.sessionAt !== undefined && now - s.sessionAt <= RECENT_MS);

/** A row is in scope when EITHER side qualifies -- "running here, cold there"
 *  is exactly the kind of difference this page exists to show. */
export function inScope(row: Row, scope: Scope, now: number): boolean {
  if (scope === "all") return true;
  const sides = [row.left, row.right].filter(Boolean) as SideInfo[];
  const test = scope === "live" ? isLive : (s: SideInfo) => isRecent(s, now);
  return sides.some(test);
}

export function filterScope(rows: Row[], scope: Scope, now: number): Row[] {
  return scope === "all" ? rows : rows.filter((r) => inScope(r, scope, now));
}

/** Counts for the three buttons, over the whole comparison -- deliberately
 *  independent of the verdict and text filters, so the numbers do not shift
 *  under you while you narrow something else. */
export function scopeCounts(rows: Row[], now: number): Record<Scope, number> {
  return {
    live: rows.filter((r) => inScope(r, "live", now)).length,
    recent: rows.filter((r) => inScope(r, "recent", now)).length,
    all: rows.length,
  };
}
