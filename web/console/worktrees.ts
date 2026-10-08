/** Pure worktree arithmetic: filtering, grouping, ordering, and what each row
 *  and palette entry is allowed to do. No React, no DOM. */
import { STATES } from "../shared/glyphs";
import { bySpace, groupPosition } from "../shared/sidebarOrder";
import type { Node, State } from "../shared/types";
import type { Verb } from "./types";

export type Opts = { cold: boolean; needle: string };

export function keep(n: Node, o: Opts): boolean {
  if (!o.cold && n.state === "cold") return false;
  const q = o.needle.trim().toLowerCase();
  if (!q) return true;
  return (
    n.label.toLowerCase().includes(q) ||
    n.repo.toLowerCase().includes(q) ||
    (n.branch ?? "").toLowerCase().includes(q)
  );
}

export type RepoGroup = {
  repoRoot: string;
  repo: string;
  /** the repo's own rolled-up state, from its "repo" node */
  state: State;
  /** every worktree in the repo, filtered or not -- the header's count */
  total: number;
  rows: Node[];
};

/** Groups in the order the server returned them: each repo node precedes its
 *  worktrees, so first appearance is the right order and no sort is needed. */
export function groupByRepo(nodes: Node[], o: Opts): RepoGroup[] {
  const repoState = new Map<string, State>();
  const totals = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === "repo") repoState.set(n.repoRoot, n.state);
    else totals.set(n.repoRoot, (totals.get(n.repoRoot) ?? 0) + 1);
  }
  const groups = new Map<string, RepoGroup>();
  for (const n of nodes) {
    if (n.kind !== "worktree" || !keep(n, o)) continue;
    let g = groups.get(n.repoRoot);
    if (!g) {
      g = {
        repoRoot: n.repoRoot,
        repo: n.repo,
        state: repoState.get(n.repoRoot) ?? "cold",
        total: totals.get(n.repoRoot) ?? 0,
        rows: [],
      };
      groups.set(n.repoRoot, g);
    }
    g.rows.push(n);
  }
  // the sidebar's order: repos by their first open space, and inside a repo
  // its own checkout first, then worktrees by space. Positions come from ALL
  // of a repo's worktrees, not just the filtered ones, so hiding cold rows
  // never moves a repo.
  const all = nodes.filter((n) => n.kind === "worktree");
  const position = new Map<string, number>();
  for (const root of groups.keys()) position.set(root, groupPosition(all.filter((n) => n.repoRoot === root)));
  const isRoot = (n: Node) => n.path === n.repoRoot;
  for (const g of groups.values()) {
    g.rows.sort((a, b) => Number(isRoot(b)) - Number(isRoot(a)) || bySpace(a, b));
  }
  return [...groups.values()].sort((a, b) => position.get(a.repoRoot)! - position.get(b.repoRoot)!);
}

/** Everything with a transcript, newest first -- "what was I just doing". */
export function byAge(nodes: Node[], o: Opts): Node[] {
  return nodes
    .filter((n) => n.kind === "worktree" && n.sessionAt && keep(n, o))
    .sort((a, b) => (b.sessionAt ?? 0) - (a.sessionAt ?? 0));
}

export function stateCounts(nodes: Node[]): Record<State, number> {
  const out = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<State, number>;
  for (const n of nodes) if (n.kind === "worktree") out[n.state]++;
  return out;
}

/** A live terminal exists only for running or idle-open worktrees. */
export function canTail(n: Node): boolean {
  return Boolean(n.paneId) && (n.state === "running" || n.state === "open");
}

/** Which of the five verbs a row may offer right now. */
export function allowed(n: Node): Record<Verb, boolean> {
  const running = n.state === "running";
  return {
    open: true,
    resume: Boolean(n.sessionId) && !running,
    start: !running,
    // quit + resume the same session in the same pane, keeping its flags --
    // how a running agent picks up a changed .envrc (maw token use)
    restart: running,
    kill: running,
    close: Boolean(n.workspaceId),
  };
}

/* ── command palette ─────────────────────────────────────────────────── */

export type PaletteGroup = { title: string; items: Node[] };

/** Ranked by what you reach for from a palette: what is running, then what
 *  you could resume (newest first), then -- only once you type -- the rest. */
export function paletteGroups(nodes: Node[], query: string): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const trees = nodes.filter((n) => n.kind === "worktree");
  const match = (n: Node) =>
    !q || n.label.toLowerCase().includes(q) || n.repo.toLowerCase().includes(q);

  const running = trees.filter((n) => n.state === "running" && match(n));
  const resumable = trees
    .filter((n) => n.state === "resumable" && match(n))
    .sort((a, b) => (b.sessionAt ?? 0) - (a.sessionAt ?? 0));
  const rest = q
    ? trees.filter((n) => n.state !== "running" && n.state !== "resumable" && match(n))
    : [];

  return [
    { title: "Running", items: running.slice(0, 8) },
    { title: "Resumable — most recent first", items: resumable.slice(0, 8) },
    { title: "Other matches", items: rest.slice(0, 8) },
  ].filter((g) => g.items.length > 0);
}

/** A palette pick never destroys anything: focus what runs, resume what can
 *  be resumed, open the rest. */
export function paletteVerb(n: Node): Verb {
  if (n.state === "running") return "open";
  return n.sessionId ? "resume" : "open";
}

export function paletteHint(n: Node): string {
  if (n.state === "running") return "focus ↵";
  return n.sessionId ? "resume ↵" : "open ↵";
}
