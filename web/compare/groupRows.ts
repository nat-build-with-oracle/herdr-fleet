/** Pure row arithmetic: filter, group, tally. No React, no DOM -- so the list
 *  and the graph views can share it and it stays testable on its own. */
import { groupPosition } from "../shared/sidebarOrder";
import type { Row, Verdict } from "./types";

export type Group = { repo: string; rows: Row[] };

export function filterRows(rows: Row[], shown: Set<Verdict>, needle: string): Row[] {
  const n = needle.trim().toLowerCase();
  return rows.filter(
    (r) =>
      shown.has(r.verdict) &&
      (!n || r.label.toLowerCase().includes(n) || r.repo.toLowerCase().includes(n)),
  );
}

/** The server sorts by repo then label, so one pass is enough -- no map, no
 *  re-sort, and the groups come out in the order the rows already had. */
export function groupByRepo(rows: Row[]): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.repo === r.repo) last.rows.push(r);
    else out.push({ repo: r.repo, rows: [r] });
  }
  // this machine's sidebar order (see shared/sidebarOrder), read off each
  // row's local side -- the page is "this machine vs that one", so this
  // machine's layout leads. Remote-only rows keep the scan order at the end.
  const local = (r: Row) => ({ spaceNumber: r.left?.spaceNumber });
  for (const g of out) g.rows.sort((a, b) => groupPosition([local(a)]) - groupPosition([local(b)]));
  return out.sort((a, b) => groupPosition(a.rows.map(local)) - groupPosition(b.rows.map(local)));
}

export function tallyVerdicts(rows: Row[]): [Verdict, number][] {
  const counts = new Map<Verdict, number>();
  for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  return [...counts.entries()];
}
