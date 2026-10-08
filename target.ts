/**
 * Turning what a person or agent says -- "self", "my-oracle", "<pane>",
 * a path -- into exactly one worktree. Shared by the MCP tools and, through
 * them, the fleet CLI, so both resolve a name the same way.
 *
 * "self" needs to know who is asking. A herdr pane carries HERDR_PANE_ID in
 * its environment; the stdio MCP bridge is a child of the agent's process and
 * inherits it, so it stamps every call with caller_pane. An HTTP client that
 * connects directly has no pane, and must name its target instead.
 */
import type { Node } from "./agents.ts";

export function resolveTarget(nodes: Node[], target: string | undefined, callerPane?: string): Node {
  const all = nodes.filter((n) => n.kind === "worktree");
  const t = (target ?? "self").trim();

  if (t === "self") {
    if (!callerPane) {
      throw new Error(
        '"self" needs the caller\'s herdr pane, and this call carried none (not started in a herdr pane, or not via the stdio bridge). Name the target instead.',
      );
    }
    const me = all.find((n) => n.paneId === callerPane);
    if (!me) throw new Error(`no worktree's agent is in pane ${callerPane}`);
    return me;
  }

  if (t.startsWith("/")) {
    const p = t.replace(/\/$/, "");
    const hit = all.find((n) => n.path === p);
    if (!hit) throw new Error(`no worktree at ${p}`);
    return hit;
  }

  if (/^w\w+:p\w+$/.test(t)) {
    const hit = all.find((n) => n.paneId === t);
    if (!hit) throw new Error(`no worktree is using pane ${t}`);
    return hit;
  }

  const q = t.toLowerCase();
  const tiers = [
    all.filter((n) => n.label.toLowerCase() === q),
    all.filter((n) => n.repo.toLowerCase() === q && n.path.endsWith("/" + n.repo)),
    all.filter((n) => n.label.toLowerCase().includes(q)),
  ];
  for (const hits of tiers) {
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      throw new Error(
        `"${t}" matches ${hits.length} worktrees -- name one:\n` +
          hits.slice(0, 15).map((n) => `  ${n.state.padEnd(9)} ${n.repo}/${n.label}  ${n.paneId ?? ""}`).join("\n"),
      );
    }
  }
  throw new Error(`no worktree matches "${t}"`);
}
