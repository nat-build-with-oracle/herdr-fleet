/**
 * Monthly fleet report -- a draft for a pulse-oracle discussion.
 *
 * Built only from records, never from memory: the month's snapshot folder
 * (fleet.tsv now, and its git history -- every commit is a moment the fleet
 * changed) plus the PRs merged into this repo that month. Written to
 * ψ/memory/fleet/YYYY-MM/report.md. Posting is a separate, explicit step.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { remoteTree, tree, type Node } from "./agents.ts";
import { machines } from "./hosts.ts";

const ROOT = process.env.FLEET_SNAPSHOT_DIR ?? `${import.meta.dir}/../../ψ/memory/fleet`;
const HOST = process.env.FLEET_HOST ?? ((process.env.HOSTNAME ?? "").split(".")[0] || "local");
const sh = (cmd: string, args: string[], cwd = ROOT) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const tsv = (text: string) => {
  const [h, ...ls] = text.trimEnd().split("\n");
  const cols = h!.split("\t");
  return ls.filter(Boolean).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
};
const tally = (rows: Record<string, string>[], k: string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r[k] || "?", (m.get(r[k] || "?") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(" · ");
};

/* ── the layout, as the herdr sidebar draws it ───────────────────────────
 * Open spaces only, in sidebar order (herdr's space number); a repo sits at
 * its first space, its own checkout is the header line with "main ↓N ↑M"
 * against origin, its worktrees hang off it with twigs. Marks are the
 * sidebar's own, from herdr's agent status. A moment, not a record -- so it
 * lives in the report, never in fleet.md, whose diffs it would churn. */
const MARK: Record<string, string> = { working: "◐", idle: "○", done: "✓", blocked: "×" };
const mark = (n?: Node) => (n?.agent || n?.state === "running" ? MARK[n?.status ?? ""] ?? "·" : "·");

function aheadBehind(root: string, branch: string): string {
  const out = sh("git", ["-C", root, "rev-list", "--left-right", "--count", `${branch}...origin/${branch}`]);
  const [ahead, behind] = out.split(/\s+/).map(Number);
  if (!out || (ahead === 0 && behind === 0)) return "";
  return [behind ? `↓${behind}` : "", ahead ? `↑${ahead}` : ""].filter(Boolean).join(" ");
}

function machineTree(label: string, nodes: Node[], local: boolean): string[] {
  const open = nodes.filter((n) => n.kind === "worktree" && n.workspaceId);
  const byRepo = new Map<string, Node[]>();
  const pos = (ns: Node[]) => Math.min(...ns.map((n) => n.spaceNumber ?? 1e9));
  for (const n of open) byRepo.set(n.repoRoot || n.repo, [...(byRepo.get(n.repoRoot || n.repo) ?? []), n]);
  const lines = [`▾ ${label}`];
  for (const [root, ns] of [...byRepo.entries()].sort((a, b) => pos(a[1]) - pos(b[1]))) {
    const head = ns.find((n) => n.path === root) ?? ns.find((n) => !n.linked);
    const kids = ns.filter((n) => n !== head).sort((a, b) => (a.spaceNumber ?? 1e9) - (b.spaceNumber ?? 1e9));
    const repoName = ns[0]!.repo;
    lines.push(`  ${mark(head)} ${repoName}`);
    const branch = head?.branch ?? "main";
    lines.push(`    ${branch}${local && root.startsWith("/") ? (aheadBehind(root, branch) ? " " + aheadBehind(root, branch) : "") : ""}`);
    kids.forEach((k, i) => lines.push(`    ${i === kids.length - 1 ? "└─" : "├─"} ${mark(k)} ${k.label}`));
  }
  if (open.length === 0) lines.push("  (no open spaces)");
  return lines;
}

export async function layout(): Promise<string> {
  const blocks = [machineTree("Local", await tree(), true).join("\n")];
  for (const m of (await machines()).filter((m) => m.enabled)) {
    try {
      blocks.push(machineTree(`${m.label} (${m.target})`, await remoteTree(m.id), false).join("\n"));
    } catch (e: any) {
      blocks.push(`▸ ${m.label} (${m.target})\n  unreachable: ${String(e?.message ?? e).split("\n")[0]!.slice(0, 90)}`);
    }
  }
  return ["```", blocks.join("\n\n"), "```", "", "◐ working · ○ idle · ✓ done · × blocked · · no agent  —  open spaces only, in sidebar order"].join("\n");
}

/** The per-agent /herdr-pr blocks, taken from the month's rendered fleet.md
 *  so the report and the snapshot never describe an agent two ways. */
function agentBlocks(dir: string): string {
  try {
    const md = readFileSync(`${dir}/fleet.md`, "utf8");
    const i = md.indexOf("<details");
    const j = md.lastIndexOf("</details>");
    return i >= 0 && j > i ? md.slice(i, j + "</details>".length) : "(no per-agent detail in fleet.md)";
  } catch {
    return "(fleet.md missing)";
  }
}

/** Who wrote this report, signed the /herdr-pr way. */
function signature(): string {
  const sign = `${process.env.HOME}/.claude/skills/herdr-pr/herdr-sign.sh`;
  const model = process.env.FLEET_REPORT_MODEL ?? "claude-opus-5-5";
  return existsSync(sign) ? sh(sign, [model], `${import.meta.dir}/../..`) || "(herdr-sign.sh produced nothing)" : "(herdr-pr not installed)";
}

export async function buildReport(month: string): Promise<{ path: string; text: string }> {
  const dir = `${ROOT}/${month}`;
  if (!existsSync(`${dir}/fleet.tsv`)) throw new Error(`no snapshot for ${month}`);
  const now = tsv(readFileSync(`${dir}/fleet.tsv`, "utf8"));
  const resumable = tsv(readFileSync(`${dir}/resumable.tsv`, "utf8"));

  // every snapshot commit this month = a moment the fleet changed
  // --follow: the month folder was created by a git mv, and without it the
  // history stopped at the move (the first draft showed 3 changes, not 11)
  const log = sh("git", ["log", "--follow", "--format=%h\t%ad\t%s", "--date=format:%d %H:%M", "--", `${month}/fleet.tsv`]);
  const changes = log ? log.split("\n") : [];
  // panes that came and went SINCE the first snapshot -- the first one is the
  // baseline, not 20 arrivals (the first draft counted it as such)
  const added = new Set<string>(), removed = new Set<string>();
  const first = changes.at(-1)?.split("\t")[0];
  const firstPath = first ? sh("git", ["log", "--follow", "--format=", "--name-only", "--diff-filter=A", "--", `${month}/fleet.tsv`]).split("\n").filter(Boolean).pop() : "";
  if (first && firstPath) {
    const base = sh("git", ["show", `${first}:${firstPath.replace(/^.*ψ\/memory\/fleet\//, "")}`]) || sh("git", ["show", `${first}:./${firstPath.split("/").pop()}`]);
    const baseRows = base ? tsv(base).map((r) => r.pane) : [];
    const nowRows = now.map((r) => r.pane);
    for (const pane of nowRows) if (!baseRows.includes(pane)) added.add(pane!);
    for (const pane of baseRows) if (!nowRows.includes(pane)) removed.add(pane!);
  }
  if (false) {
    const diff = "";
    for (const l of diff.split("\n")) {
      if (/^\+w/.test(l)) added.add(l.slice(1).split("\t")[0]!);
      if (/^-w/.test(l)) removed.add(l.slice(1).split("\t")[0]!);
    }
  }
  const churn = added.size - removed.size;

  const [y, m] = month.split("-").map(Number) as [number, number];
  // the real last day -- "2026-09-31" made gh return nothing, and the first
  // draft reported no PRs shipped in a month with eight
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  const prs = sh("gh", ["pr", "list", "--state", "merged", "--limit", "200", "--search", `merged:${y}-${mm}-01..${y}-${mm}-${last}`, "--json", "number,title,mergedAt,author", "--jq", '.[] | "#\\(.number)\\t\\(.mergedAt[0:10])\\t\\(.title)"']);
  const prLines = prs ? prs.split("\n").sort() : [];

  const on = now.filter((r) => r.channel === "on").length;
  const slug = sh("git", ["remote", "get-url", "origin"], `${import.meta.dir}/../..`).replace(/.*github\.com[:/]/, "").replace(/\.git$/, "") || "this repo";
  const text = [
    `# Fleet report — ${month} (${HOST})`, "",
    `> Built from \`ψ/memory/fleet/${month}/\` (the snapshot and its git history) and the PRs merged into ${slug} this month. Nothing here is from memory.`, "",
    "## Layout", "",
    `As herdr's sidebar showed it when this report was built (${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC).`, "",
    await layout(), "",
    "## At month's close", "",
    `- **${now.length} agents running**, fleet channel on for **${on}** (${Math.round((100 * on) / Math.max(1, now.length))}%)`,
    `- **${resumable.length} resumable** worktrees on disk`,
    `- models: ${tally(now, "model")}`,
    `- tokens: ${tally(now, "token")}`,
    `- repos with agents: ${tally(now, "repo")}`, "",
    "## Movement", "",
    `- **${changes.length} recorded fleet changes** (snapshot commits)`,
    `- since the month's first snapshot: ${added.size} agent pane(s) appeared, ${removed.size} disappeared (net ${churn >= 0 ? "+" : ""}${churn})`, "",
    "## Shipped (PRs merged)", "",
    ...(prLines.length ? prLines.map((l) => { const [n, d, t] = l.split("\t"); return `- ${n} · ${d} · ${t}`; }) : ["- none recorded"]), "",
    "## Change log", "",
    "| when | commit | |", "|---|---|---|",
    ...changes.slice(0, 40).map((l) => { const [h, d, s] = l.split("\t"); return `| ${d} | \`${h}\` | ${s!.replace(/^chore\(fleet\): /, "")} |`; }),
    changes.length > 40 ? `\n…and ${changes.length - 40} earlier — \`git log -- ψ/memory/fleet/${month}/\`` : "",
    "", "## Each agent", "",
    "Every running agent as `/herdr-pr` would sign it -- who, model, runtime, worktree, session, transcript, and how to reach it.", "",
    agentBlocks(dir),
    "", "## Signed", "",
    signature(),
    "", "🤖 Generated with [Claude Code](https://claude.com/claude-code) by `fleet report`",
  ].join("\n") + "\n";
  const path = `${dir}/report.md`;
  writeFileSync(path, text);
  return { path, text };
}
