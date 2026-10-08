/**
 * Fleet snapshot and restore -- stored as TSV, rendered as markdown.
 *
 *   ψ/memory/fleet/YYYY-MM/fleet.tsv      one line per running agent
 *   ψ/memory/fleet/YYYY-MM/resumable.tsv  one line per resumable worktree
 *   ψ/memory/fleet/YYYY-MM/fleet.md       rendered from the two
 *
 * One folder per month: within a month the files are stable (so a diff names
 * the agent), and a new month opens a fresh folder that starts from the fleet
 * as it is then -- each month readable on its own, none growing forever.
 *
 * Why TSV: one agent is one line, so `git diff` names exactly the agent whose
 * row changed; DuckDB reads it with read_csv and no extension; restore parses
 * it without a schema. The per-agent fields are /herdr-pr's "Built by" block
 * (who, model, runtime, cwd, branch, head, session, transcript, herdr
 * address) plus channel, token and argv -- argv is what restore relaunches.
 *
 * Volatile fields stay out on purpose -- pids, mtimes, working/idle status --
 * or every diff is noise. An unchanged fleet leaves the files untouched.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, closeSync, statSync, writeFileSync } from "node:fs";
import { herdr, paneClaude, start, tree, type Node } from "./agents.ts";

const ROOT = process.env.FLEET_SNAPSHOT_DIR ?? `${import.meta.dir}/../../ψ/memory/fleet`;
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** The folder for this month -- where snapshots are written. */
const monthDir = () => `${ROOT}/${monthOf()}`;
/** The newest month that has a snapshot -- where restore reads by default. */
function latestMonth(): string | null {
  if (!existsSync(ROOT)) return null;
  const m = readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}$/.test(d) && existsSync(`${ROOT}/${d}/fleet.tsv`)).sort().pop();
  return m ?? null;
}
const HOST = process.env.FLEET_HOST ?? (process.env.HOSTNAME ?? "local").split(".")[0];

const COLS = [
  "pane", "workspace", "agent_name", "runtime", "model", "repo", "worktree", "branch", "head",
  "session", "channel", "token", "cwd", "transcript", "argv_json",
] as const;
type Row = Record<(typeof COLS)[number], string>;

const clean = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
const toTsv = (cols: readonly string[], rows: Record<string, string>[]) =>
  [cols.join("\t"), ...rows.map((r) => cols.map((c) => clean(r[c])).join("\t"))].join("\n") + "\n";
const fromTsv = (text: string): Record<string, string>[] => {
  const [head, ...lines] = text.trimEnd().split("\n");
  const cols = head!.split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
};

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** The model a Claude transcript last answered with -- read from the tail,
 *  since transcripts run to tens of MB. */
function lastModel(transcript: string): string {
  try {
    const size = statSync(transcript).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    const fd = openSync(transcript, "r");
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    const hits = [...buf.toString("utf8").matchAll(/"model":"(claude-[^"]+)"/g)];
    return hits.at(-1)?.[1] ?? "";
  } catch {
    return "";
  }
}

// Name of the .envrc variable that labels which account an agent runs under.
const TOKEN_VAR = process.env.FLEET_TOKEN_VAR ?? "CLAUDE_TOKEN_NAME";
const TOKEN_RE = new RegExp(`${TOKEN_VAR}="?([\\w-]+)`);

const tokenOf = (cwd: string) => {
  try {
    return readFileSync(`${cwd}/.envrc`, "utf8").match(TOKEN_RE)?.[1] ?? "";
  } catch {
    return "";
  }
};

async function collect() {
  const nodes = (await tree()).filter((n) => n.kind === "worktree");
  const agents = JSON.parse(await herdr(["agent", "list"])).result?.agents ?? [];
  const rows: Row[] = [];
  for (const n of nodes.filter((n) => n.state === "running" && n.paneId)) {
    const c = await paneClaude(n.paneId!).catch(() => null);
    const a = agents.find((x: any) => x.pane_id === n.paneId);
    const cwd = a?.cwd ?? n.path;
    const session = c?.sessionId ?? n.sessionId ?? "";
    const transcript = session
      ? `${process.env.HOME}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, "-")}/${session}.jsonl`
      : "";
    rows.push({
      pane: n.paneId!, workspace: n.workspaceId ?? "", agent_name: a?.name ?? "", runtime: a?.agent ?? n.agent ?? "",
      model: transcript ? lastModel(transcript) : "", repo: n.repo, worktree: n.label,
      branch: git(cwd, "branch", "--show-current"),
      // the last commit that is not a snapshot: committing a snapshot moves
      // HEAD of the worktree that holds ψ/memory/fleet, so the next snapshot
      // saw its own commit as a change and committed again, forever
      head: git(cwd, "log", "-1", "--format=%h", "--", ".", ":(exclude)ψ/memory/fleet"),
      session, channel: c?.argv?.includes("--dangerously-load-development-channels") ? "on" : "off",
      token: tokenOf(cwd), cwd, transcript: transcript && existsSync(transcript) ? transcript : "",
      argv_json: c?.argv ? JSON.stringify(c.argv) : "",
    });
  }
  rows.sort((x, y) => x.pane.localeCompare(y.pane, undefined, { numeric: true }));
  const resumable = nodes
    .filter((n) => n.state === "resumable")
    .map((n) => ({ repo: n.repo, worktree: n.label, branch: n.branch ?? "", session: n.sessionId ?? "", cwd: n.path }))
    .sort((x, y) => x.cwd.localeCompare(y.cwd));
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.state] = (counts[n.state] ?? 0) + 1;
  return { rows, resumable, counts, total: nodes.length };
}

function render(rows: Row[], resumable: Record<string, string>[], counts: Record<string, number>, total: number): string {
  const on = rows.filter((r) => r.channel === "on").length;
  const out = [
    `# fleet — ${HOST} — ${monthOf()}`, "",
    `${total} worktrees · ` + Object.entries(counts).sort().map(([k, v]) => `${v} ${k}`).join(" · ") +
      ` · channel on for ${on} of ${rows.length} running`, "",
    "Source of truth: `fleet.tsv` (running) and `resumable.tsv`. This file is rendered from them.", "",
    "| pane | who | model | branch | session | channel | token |", "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.pane} | ${r.repo} / ${r.worktree} | ${r.model.replace(/^claude-/, "") || "?"} | ${r.branch || "—"} | \`${r.session.slice(0, 8) || "?"}\` | ${r.channel} | ${r.token || "—"} |`),
    "", "## Each agent", "",
  ];
  for (const r of rows) {
    out.push(
      `<details open><summary><b>${r.pane}</b> — ${r.repo} / ${r.worktree}</summary>`, "", "```yaml",
      "agent:", `  who: ${r.agent_name || "(unnamed)"} — ${r.repo}`, `  model: ${r.model || "?"}`, `  runtime: ${r.runtime || "?"}`,
      "worktree:", `  cwd: ${r.cwd}`, `  branch: ${r.branch || "?"}`, `  head: ${r.head || "?"}`,
      "session:", `  id: ${r.session || "?"}`, `  transcript: ${r.transcript || "?"}`,
      "reach:", `  herdr: ${HOST} ${r.workspace} ${r.pane}`, `  fleet: fleet send ${r.pane} "…"`,
      `  channel: ${r.channel}`, `  token: ${r.token || "?"}`, "```", "", "</details>", "",
    );
  }
  out.push(
    `${resumable.length} resumable worktrees — see \`resumable.tsv\`.`, "",
    "Restore: `fleet restore` (plan) · `--go` to run · `--rev <git rev>` for an earlier state.",
    `History: \`git log -p ψ/memory/fleet/${monthOf()}/fleet.tsv\` — one line per agent, so each diff names the agent.`, "",
    "Query (DuckDB, no extension): `duckdb -c \"select pane, repo, worktree from read_csv('fleet.tsv', delim='\\t') where channel='off'\"`",
    `Past state: \`git show HEAD~5:ψ/memory/fleet/${monthOf()}/fleet.tsv | duckdb -c "select count(*) from read_csv('/dev/stdin', delim='\\t')"\``,
    "All months at once: `duckdb -c \"select filename, count(*) from read_csv('ψ/memory/fleet/*/fleet.tsv', delim='\\t', filename=true) group by 1\"`",
  );
  return out.join("\n") + "\n";
}

export async function takeSnapshot() {
  const { rows, resumable, counts, total } = await collect();
  const DIR = monthDir();
  mkdirSync(DIR, { recursive: true });
  const files = {
    tsv: `${DIR}/fleet.tsv`,
    resumable: `${DIR}/resumable.tsv`,
    md: `${DIR}/fleet.md`,
  };
  const tsv = toTsv(COLS, rows);
  const rtsv = toTsv(["repo", "worktree", "branch", "session", "cwd"], resumable);
  const unchanged =
    existsSync(files.tsv) && readFileSync(files.tsv, "utf8") === tsv &&
    existsSync(files.resumable) && readFileSync(files.resumable, "utf8") === rtsv &&
    existsSync(files.md);
  if (!unchanged) {
    writeFileSync(files.tsv, tsv);
    writeFileSync(files.resumable, rtsv);
    writeFileSync(files.md, render(rows, resumable, counts, total));
  }
  return { files, rows, resumable, unchanged };
}

/** Commit the snapshot, message naming what changed. Only these files. */
export function commitSnapshot(rows: Row[], resumable: unknown[]): string {
  const g = (...a: string[]) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
  const m = monthOf();
  const names = [`${m}/fleet.tsv`, `${m}/resumable.tsv`, `${m}/fleet.md`];
  g("add", ...names);
  if (!g("diff", "--cached", "--name-only", "--", ...names)) return "no change since the last snapshot -- nothing committed";
  const changed = g("diff", "--cached", "-U0", "--", `${m}/fleet.tsv`).split("\n").filter((l) => /^[+-]w/.test(l)).map((l) => l.slice(0, 1) + l.slice(1).split("\t")[0]);
  const on = rows.filter((r) => r.channel === "on").length;
  const msg = `chore(fleet): snapshot ${m} -- ${rows.length} running, channel on ${on}, ${resumable.length} resumable` +
    (changed.length ? `\n\nrows changed: ${[...new Set(changed)].join(" ")}` : "");
  g("commit", "-q", "-m", msg, "--", ...names);
  return `committed ${g("rev-parse", "--short", "HEAD")}: ${msg.split("\n")[0]}`;
}

export async function restore(opts: { rev?: string; month?: string; go?: boolean } = {}): Promise<string> {
  const go = opts.go === true;
  const month = opts.month ?? latestMonth();
  if (!month) throw new Error("no snapshot yet -- run fleet snapshot first");
  const raw = opts.rev
    ? execFileSync("git", ["-C", ROOT, "show", `${opts.rev}:./${month}/fleet.tsv`], { encoding: "utf8" })
    : existsSync(`${ROOT}/${month}/fleet.tsv`) ? readFileSync(`${ROOT}/${month}/fleet.tsv`, "utf8") : null;
  if (!raw) throw new Error("no snapshot yet -- run fleet snapshot first");
  const rows = fromTsv(raw);
  const panes = new Set<string>((JSON.parse(await herdr(["pane", "list"])).result?.panes ?? []).map((p: any) => p.pane_id));
  const nodes = await tree();
  const lines: string[] = [];
  for (const r of rows) {
    const label = r.worktree!;
    const live = panes.has(r.pane!) ? await paneClaude(r.pane!).catch(() => null) : null;
    if (live) { lines.push(`keep     ${label}  ${r.pane} already running`); continue; }
    if (!r.session) { lines.push(`SKIP     ${label}  no session recorded`); continue; }
    const argv: string[] = r.argv_json ? JSON.parse(r.argv_json) : [];
    if (panes.has(r.pane!) && argv.length) {
      const args = argv.slice(1).filter((a, i, all) => a !== "--resume" && all[i - 1] !== "--resume");
      lines.push(`relaunch ${label}  in ${r.pane} on ${r.session.slice(0, 8)}${r.channel === "on" ? " (channel on)" : ""}`);
      if (go) {
        const name = (r.agent_name || label).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^([^a-z])/, "w-$1").slice(0, 24);
        await herdr(["agent", "start", name, "--kind", "claude", "--pane", r.pane!, "--", ...args, "--resume", r.session]);
      }
      continue;
    }
    const n = nodes.find((x: Node) => x.kind === "worktree" && x.path === r.cwd);
    if (!n) { lines.push(`SKIP     ${label}  worktree gone (${r.cwd})`); continue; }
    lines.push(`resume   ${label}  pane gone -> new space on ${r.session.slice(0, 8)}`);
    if (go) await start({ ...n, paneId: undefined, sessionId: r.session }, true);
  }
  return [`${month}/fleet.tsv${opts.rev ? ` @ ${opts.rev}` : ""} -- ${go ? "RAN" : "plan only, add --go"}:`, ...lines].join("\n");
}
