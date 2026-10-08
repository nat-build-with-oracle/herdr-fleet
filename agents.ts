/**
 * Claude Code lifecycle, scanned from the WORKTREES rather than the open
 * herdr spaces.
 *
 * Closing a herdr space destroys nothing: the worktree stays on disk and its
 * transcript stays in ~/.claude/projects, so the session is still resumable.
 * A workspace-only listing therefore hides most of the work -- measured on
 * some-oracle: 35 worktrees, 4 with an open space, 31 invisible.
 *
 * `git worktree list --porcelain` answers per repo including the closed ones.
 * It is asked of git directly, not through herdr's `worktree.list`: herdr runs
 * that same git command on the loop that forwards keystrokes, and one call per
 * repo on every rebuild froze the default session ~1 s every 5 s (#108). The
 * repo set comes from a shallow glob for wt directories under the ghq root,
 * which finds the same 25 repos as `ghq list --full-path` in 12 ms instead of
 * 17 s.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { machines, socketCall } from "./hosts.ts";

const HERDR = process.env.HERDR_BIN_PATH ?? "herdr";

export type State = "running" | "open" | "resumable" | "cold";

export type Node = {
  kind: "repo" | "worktree";
  repo: string;
  repoRoot: string;
  label: string;
  path: string;
  branch?: string;
  linked: boolean;
  state: State;
  status: string;
  agent?: string;
  workspaceId?: string;
  paneId?: string;
  sessionId?: string;
  /** mtime of the transcript we would resume, and its size in bytes */
  sessionAt?: number;
  sessionBytes?: number;
  /** the open herdr space's position in the sidebar (herdr's workspace
   *  "number"); absent when no space is open. Pages sort by it so they list
   *  things in the order the sidebar does. */
  spaceNumber?: number;
};

/** Raw herdr CLI call, for callers outside this module. */
export const herdr = (args: string[]) => run(args);

function run(args: string[], timeout = 45000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(HERDR, args, { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout);
    });
  });
}

function git(dir: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotepath=off", "-C", dir, ...args],
      { timeout, maxBuffer: 32 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)),
    );
  });
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** One checkout, in the shape tree() used to read from herdr's worktree.list. */
type Worktree = {
  path: string;
  branch?: string;
  is_bare: boolean;
  is_linked_worktree: boolean;
  open_workspace_id?: string;
};

async function gitWorktrees(root: string): Promise<Worktree[]> {
  const out = await git(root, ["worktree", "list", "--porcelain"]);
  return out
    .trim()
    .split("\n\n")
    .filter((b) => b.startsWith("worktree "))
    .map((b, i) => ({
      path: real(b.match(/^worktree (.*)$/m)![1]),
      branch: b.match(/^branch refs\/heads\/(.*)$/m)?.[1],
      is_bare: /^bare$/m.test(b),
      // git lists the main worktree first; every later block is a linked one
      is_linked_worktree: i > 0,
    }));
}

/** Which open space shows each checkout, by the rule herdr's worktree.list
 *  applies (open_workspace_idx_for_checkout): a space bound to the checkout, or
 *  a space whose cwd lies inside it. The innermost checkout owns a cwd, so a
 *  space in repo/wt/x belongs to that worktree and not to repo, and the first
 *  space wins. herdr's identity cwd is not in the API; the space's first pane
 *  stands in for it. */
function openSpaces(
  workspaces: any[],
  panes: any[],
  firstPane: Map<string, string>,
  checkouts: string[],
): Map<string, string> {
  const known = new Set(checkouts);
  const innermost = [...known].sort((a, b) => b.length - a.length);
  const cwdOf = new Map<string, string>(panes.map((p) => [p.pane_id, p.cwd]));
  const out = new Map<string, string>();
  for (const w of workspaces) {
    const bound = w.worktree?.checkout_path ? real(w.worktree.checkout_path) : undefined;
    const cwd = cwdOf.get(firstPane.get(w.workspace_id) ?? "");
    const inside = cwd ? real(cwd) : undefined;
    const key =
      bound && known.has(bound)
        ? bound
        : inside
          ? innermost.find((p) => inside === p || inside.startsWith(p + "/"))
          : undefined;
    if (key && !out.has(key)) out.set(key, w.workspace_id);
  }
  return out;
}

function sh(cmd: string, timeout = 30000): Promise<string> {
  return new Promise((resolve) => {
    execFile("sh", ["-c", cmd], { timeout, maxBuffer: 32 << 20 }, (_e, stdout) =>
      resolve(stdout ?? ""),
    );
  });
}

function transcriptDir(cwd: string): string {
  return `${process.env.HOME}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

type Transcript = { id: string; at: number; size: number };

function newestSession(cwd: string): Transcript | undefined {
  try {
    const dir = transcriptDir(cwd);
    if (!existsSync(dir)) return undefined;
    const best = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const s = statSync(`${dir}/${f}`);
        return { id: f.slice(0, -6), at: s.mtimeMs, size: s.size };
      })
      // an empty transcript resumes into nothing, so it is not a session
      .filter((f) => f.size > 1024)
      .sort((a, b) => b.at - a.at)[0];
    return best;
  } catch {
    return undefined;
  }
}

async function repoRoots(openRoots: string[]): Promise<string[]> {
  const root = (await sh("ghq root")).trim();
  const globbed = (await sh(`ls -d ${root}/github.com/*/*/wt 2>/dev/null`))
    .split("\n")
    .filter(Boolean)
    .map((p) => p.replace(/\/wt$/, ""));
  // ghq holds alias symlinks (homekeeper-oracle -> homelab), and both sides of
  // one would list the same worktrees twice under two repo names
  const byReal = new Map<string, string>();
  for (const p of [...globbed, ...openRoots]) {
    let real = p;
    try {
      real = realpathSync(p);
    } catch {
      continue;
    }
    if (!byReal.has(real)) byReal.set(real, real);
  }
  return [...byReal.values()].sort();
}

export async function tree(): Promise<Node[]> {
  const [spaces, agentList, paneList] = await Promise.all([
    socketCall("workspace.list"),
    socketCall("agent.list").catch(() => ({ agents: [] })),
    socketCall("pane.list").catch(() => ({ panes: [] })),
  ]);

  const spaceById = new Map<string, any>();
  for (const w of spaces.workspaces ?? []) spaceById.set(w.workspace_id, w);
  const agentByWorkspace = new Map<string, any>();
  for (const a of agentList.agents ?? []) agentByWorkspace.set(a.workspace_id, a);

  // A workspace's panes are not always numbered from p1 -- close the first pane
  // and the rest keep their ids. Assuming ":p1" made fleet_tail fail on any
  // such space, so resolve the real first pane instead.
  const firstPaneByWorkspace = new Map<string, string>();
  const panesByWorkspace = new Map<string, any[]>();
  for (const p of paneList.panes ?? []) {
    if (!firstPaneByWorkspace.has(p.workspace_id)) {
      firstPaneByWorkspace.set(p.workspace_id, p.pane_id);
    }
    const list = panesByWorkspace.get(p.workspace_id) ?? [];
    list.push(p);
    panesByWorkspace.set(p.workspace_id, list);
  }

  const openRoots = (spaces.workspaces ?? [])
    .map((w: any) => w.worktree?.repo_root)
    .filter(Boolean);

  const roots = await repoRoots(openRoots);

  const perRepo = await Promise.all(
    roots.map(async (root) => ({
      root,
      worktrees: await gitWorktrees(root).catch(() => [] as Worktree[]),
    })),
  );
  const open = openSpaces(
    spaces.workspaces ?? [],
    paneList.panes ?? [],
    firstPaneByWorkspace,
    perRepo.flatMap((r) => r.worktrees.map((w) => w.path)),
  );
  for (const { worktrees } of perRepo) {
    for (const w of worktrees) w.open_workspace_id = open.get(w.path);
  }

  const out: Node[] = [];
  for (const { root, worktrees } of perRepo) {
    if (worktrees.length === 0) continue;
    const repo = root.split("/").pop()!;

    const kids: Node[] = worktrees
      .filter((w) => !w.is_bare)
      .map((w): Node => {
        const space = w.open_workspace_id ? spaceById.get(w.open_workspace_id) : undefined;
        const agent = w.open_workspace_id ? agentByWorkspace.get(w.open_workspace_id) : undefined;
        const transcript = newestSession(w.path);
        const sessionId = agent?.agent_session?.value ?? transcript?.id;
        const state: State = agent
          ? "running"
          : space
            ? "open"
            : sessionId
              ? "resumable"
              : "cold";
        return {
          kind: "worktree",
          repo,
          repoRoot: root,
          label: space?.label ?? w.path.split("/").pop()!,
          path: w.path,
          branch: w.branch,
          linked: Boolean(w.is_linked_worktree),
          state,
          status: space?.agent_status ?? "unknown",
          agent: agent?.agent,
          workspaceId: w.open_workspace_id,
          spaceNumber: space?.number,
          paneId:
            agent?.pane_id ??
            (w.open_workspace_id ? firstPaneByWorkspace.get(w.open_workspace_id) : undefined),
          sessionId,
          sessionAt: transcript?.at,
          sessionBytes: transcript?.size,
        };
      })
      .sort((a, b) => {
        const rank = (n: Node) => (n.linked ? 1 : 0);
        return rank(a) - rank(b) || a.label.localeCompare(b.label);
      });

    out.push({
      kind: "repo",
      repo,
      repoRoot: root,
      label: repo,
      path: root,
      linked: false,
      state: kids.some((k) => k.state === "running")
        ? "running"
        : kids.some((k) => k.state === "open")
          ? "open"
          : kids.some((k) => k.state === "resumable")
            ? "resumable"
            : "cold",
      status: "unknown",
    });
    out.push(...kids);
  }

  /* A herdr workspace does not have to own a git worktree. "omp" is two codex
   * panes sitting in other repos' checkouts; the sidebar lists it, but a scan
   * that starts from worktrees can never reach it. Anything still unclaimed
   * after the loop above is such a space, and dropping it silently made fleet
   * disagree with the sidebar. Claim them here, keyed off the panes they hold. */
  const claimed = new Set(out.map((n) => n.workspaceId).filter(Boolean));
  for (const w of spaces.workspaces ?? []) {
    if (claimed.has(w.workspace_id)) continue;
    const agent = agentByWorkspace.get(w.workspace_id);
    const panes = panesByWorkspace.get(w.workspace_id) ?? [];
    // no checkout of its own, so the pane's cwd is the only real location
    const cwd = agent?.cwd ?? panes[0]?.cwd ?? w.worktree?.checkout_path;
    const transcript = cwd ? newestSession(cwd) : undefined;
    const sessionId = agent?.agent_session?.value ?? transcript?.id;
    out.push({
      kind: "worktree",
      repo: w.worktree?.repo_name ?? w.label,
      repoRoot: w.worktree?.repo_root ?? cwd ?? "",
      label: w.label,
      path: cwd ?? `herdr:${w.workspace_id}`,
      branch: undefined,
      linked: false,
      state: agent ? "running" : "open",
      status: w.agent_status ?? "unknown",
      agent: agent?.agent,
      workspaceId: w.workspace_id,
      spaceNumber: w.number,
      paneId: agent?.pane_id ?? firstPaneByWorkspace.get(w.workspace_id),
      sessionId,
      sessionAt: transcript?.at,
      sessionBytes: transcript?.size,
    });
  }

  return out;
}

/** A closed worktree has no space, so it must be opened before it can hold an agent. */
export async function openSpace(node: Node) {
  if (node.workspaceId) {
    await run(["workspace", "focus", node.workspaceId]);
    return;
  }
  // scoping with the repo root keeps herdr from resolving the parent as the
  // active (possibly linked) workspace, which fails with linked_worktree_source
  await run(["worktree", "open", "--cwd", node.repoRoot, "--path", node.path, "--focus"]);
}

export async function start(node: Node, resume: boolean) {
  let paneId = node.paneId;
  if (!paneId) {
    const out = await run([
      "worktree", "open", "--cwd", node.repoRoot, "--path", node.path,
    ]);
    const ws = JSON.parse(out).result?.workspace?.workspace_id;
    if (!ws) throw new Error("could not open a space for this worktree");
    paneId = `${ws}:p1`;
  }
  // herdr requires an agent name starting with a lowercase letter -- a label
  // like "01-petkeeper" fails outright, so sanitize rather than pass it raw
  let agentName = node.label.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 24);
  if (!/^[a-z]/.test(agentName)) agentName = `w-${agentName}`.slice(0, 24);
  const args = ["agent", "start", agentName, "--kind", "claude", "--pane", paneId];
  if (resume && node.sessionId) args.push("--", "--resume", node.sessionId);
  await run(args);
}

/** Stop the agent in a worktree's pane; the pane survives for a restart. */
export async function kill(node: Node) {
  if (!node.paneId) throw new Error("nothing running here");
  await quitPane(node.paneId);
}

/**
 * Send Ctrl-C until the pane's Claude has actually exited.
 *
 * Not a fixed two presses: Claude mid-turn spends the first cancelling the
 * turn and the second arming "press again to exit", so two could leave it
 * running while kill reported success. When the pane holds no Claude we can
 * see -- some other agent, or a bare command -- fall back to the classic two.
 * Returns what was running, for callers that relaunch it.
 */
export async function quitPane(pane: string) {
  const c = await paneClaude(pane);
  if (!c) {
    await run(["pane", "send-keys", pane, "ctrl+c"]);
    await new Promise((r) => setTimeout(r, 250));
    await run(["pane", "send-keys", pane, "ctrl+c"]);
    return null;
  }
  const gone = () => {
    try {
      process.kill(c.pid, 0);
      return false;
    } catch {
      return true;
    }
  };
  for (let i = 0; i < 8 && !gone(); i++) {
    await run(["pane", "send-keys", pane, "ctrl+c"]);
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!gone()) throw new Error(`Claude pid ${c.pid} in ${pane} did not exit after 8 ctrl-c`);
  return c;
}

/** The Claude running in a pane, read from the process itself rather than
 *  from herdr's agent list: a Claude started by hand in a pane is never
 *  registered there, and a registered one's recorded session goes stale the
 *  moment it forks. Claude Code writes ~/.claude/sessions/<pid>.json with the
 *  session the process is on right now; that is the one to resume. */
export async function paneClaude(pane: string): Promise<{ pid: number; argv: string[]; sessionId?: string } | null> {
  const info = JSON.parse(await run(["pane", "process-info", "--pane", pane])).result?.process_info;
  const proc = (info?.foreground_processes ?? []).find(
    (p: any) => p.name === "claude" || /(^|\/)claude$/.test(p.argv0 ?? ""),
  );
  if (!proc) return null;
  let sessionId: string | undefined;
  try {
    sessionId = JSON.parse(readFileSync(`${process.env.HOME}/.claude/sessions/${proc.pid}.json`, "utf8")).sessionId;
  } catch {}
  return { pid: proc.pid, argv: proc.argv, sessionId };
}

/** The original command line, minus whatever pointed it at a session, plus
 *  --resume for the session it is on now. Keeps the flags it was started
 *  with -- permissions mode, channels, model -- which a bare
 *  "claude --resume" would silently drop. */
function resumeArgs(argv: string[], sessionId: string): string[] {
  const out: string[] = [];
  // Each flag once. herdr types the command into the pane's shell, where a
  // `claude` alias may add its own flags; carrying the old argv over as well
  // grew the command by one full copy per restart (seen: three
  // --dangerously-skip-permissions after the third). Duplicates add nothing,
  // so drop them -- a flag and its value count as one unit.
  const seen = new Set<string>();
  const withValue = new Set(["--resume", "-r", "--session-id"]);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (withValue.has(a)) { i++; continue; }
    if (a === "--continue" || a === "-c" || a === "--fork-session" || /^--(resume|session-id)=/.test(a)) continue;
    const next = argv[i + 1];
    const pair = a.startsWith("-") && !a.includes("=") && next !== undefined && !next.startsWith("-");
    const unit = pair ? [a, next!] : [a];
    if (pair) i++;
    const k = unit.join("\u0000");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(...unit);
  }
  return [...out, "--resume", sessionId];
}

/** Quit the Claude in a pane and resume the same session in the same pane.
 *
 *  The point is to pick up a changed environment -- `maw token use` rewrites
 *  .envrc, which a running Claude never re-reads. Once Claude exits, the
 *  pane's shell prompt returns and direnv loads the new .envrc; the resumed
 *  Claude inherits it.
 *
 *  Ctrl-C is sent until the process is actually gone, not a fixed twice: a
 *  Claude mid-turn spends the first Ctrl-C cancelling the turn and the second
 *  arming "press again to exit". The Claude can be the caller itself, so the
 *  server runs this detached and never waits on it. */
const DEV_CHANNEL = ["--dangerously-load-development-channels", "server:fleet"];

/** Turn the fleet channel on or off in a relaunch command. undefined keeps
 *  whatever the process already had, so a restart never silently changes it. */
function withChannel(args: string[], channel?: boolean): string[] {
  const has = args.includes(DEV_CHANNEL[0]!);
  if (channel === true && !has) return [...DEV_CHANNEL, ...args];
  if (channel === false && has) {
    const i = args.indexOf(DEV_CHANNEL[0]!);
    return [...args.slice(0, i), ...args.slice(i + 2)];
  }
  return args;
}

/** A Claude loading a development channel stops on a warning at startup
 *  ("1. I am using this for local development" is preselected). Accept it,
 *  or the relaunch hangs unattended. Proven by hand before this was written. */
async function acceptChannelWarning(pane: string) {
  // 90 s, not 20: the warning is drawn only after Claude has started its MCP
  // servers, and with ~30 configured (several timing out) that took longer
  // than 20 s on a real pane -- the loop gave up before the warning appeared.
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const screen = await run(["pane", "read", pane, "--source", "visible", "--lines", "40"]).catch(() => "");
    if (/Loading development channels/i.test(screen) && /I am using this for local development/i.test(screen)) {
      await run(["pane", "send-keys", pane, "enter"]);
      return true;
    }
    // No "already past it" shortcut: right after the relaunch the pane still
    // shows the OLD Claude's status bar, and reading that as "past the
    // warning" gave up before the warning was even drawn -- the agent then sat
    // on it unattended (seen on a real pane). Only the warning itself counts; if it
    // never shows within the window, there was none to accept.
  }
  return false;
}

export async function restartPane(pane: string, name = "claude", opts: { channel?: boolean } = {}) {
  const c = await paneClaude(pane);
  if (!c) throw new Error(`no Claude running in pane ${pane}`);
  if (!c.sessionId) throw new Error(`cannot tell which session pid ${c.pid} in ${pane} is on -- not restarting blind`);
  await quitPane(pane);
  // let the shell draw its prompt, which is when direnv reloads .envrc
  await new Promise((r) => setTimeout(r, 800));
  let agentName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 24);
  if (!/^[a-z]/.test(agentName)) agentName = `w-${agentName}`.slice(0, 24);
  const args = withChannel(resumeArgs(c.argv, c.sessionId), opts.channel);
  const channel = args.includes(DEV_CHANNEL[0]!);
  // Watch for the warning WHILE starting, not after: `herdr agent start`
  // waits for the agent to be interactive, and an agent parked on the warning
  // never is -- so awaiting the start first meant the accept never ran and
  // the start timed out (seen twice on a real pane).
  const accept = channel ? acceptChannelWarning(pane) : Promise.resolve(false);
  const started = run(["agent", "start", agentName, "--kind", "claude", "--pane", pane, "--", ...args], 150_000);
  const [ok, accepted] = await Promise.allSettled([started, accept]);
  if (channel) {
    // an unattended agent stuck on this screen looks exactly like a dead one
    console.error(`restart ${pane}: channel warning ${accepted.status === "fulfilled" && accepted.value ? "accepted" : "NOT seen within 90s"}`);
  }
  if (ok.status === "rejected") throw ok.reason;
}

/** Type a prompt into the Claude running in a pane.
 *
 *  By exact pane id -- never `herdr agent prompt <name>`, which prefix-matches
 *  agent names and has delivered to the wrong agent here before. Only into a
 *  pane with a Claude in it: text plus Enter into a bare shell is a command.
 *
 *  Line breaks go in as Shift+Enter, Claude's own "new line, keep typing": a
 *  typed newline is Enter and would split one prompt into several, and the
 *  backslash-Enter form left a literal "\" in the text. Measured on a live
 *  agent: two lines arrived as one prompt.
 *
 *  An Enter that lands right after the text is swallowed as part of the input
 *  (seen at 150 ms). So: wait, press Enter, confirm the agent went to work,
 *  and press once more if it did not -- an extra Enter on an empty box is a
 *  no-op. `submit: false` leaves the text in the box for a human. */
export async function sendToPane(pane: string, text: string, submit = true) {
  const body = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (!body.trim()) throw new Error("nothing to send");
  const c = await paneClaude(pane);
  if (!c) throw new Error(`no Claude running in pane ${pane} -- not typing into it`);
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await run(["pane", "send-text", pane, lines[i]!]);
    if (i < lines.length - 1) await run(["pane", "send-keys", pane, "shift+enter"]);
  }
  if (!submit) return { ...c, submitted: false };
  const working = async () => {
    const list = JSON.parse(await run(["agent", "list"])).result?.agents ?? [];
    return list.find((a: any) => a.pane_id === pane)?.agent_status === "working";
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    await run(["pane", "send-keys", pane, "enter"]);
    for (let t = 0; t < 8; t++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await working()) return { ...c, submitted: true };
    }
  }
  // herdr may not track this pane's status, or the reply was instant; the text
  // was delivered either way, so report rather than fail
  return { ...c, submitted: false };
}

/** Closes the herdr space only -- the worktree and its transcript stay. */
export async function closeSpace(node: Node) {
  if (!node.workspaceId) throw new Error("no open space");
  await run(["workspace", "close", node.workspaceId]);
}

/** Recent terminal text for a pane -- what a running agent is doing right now. */
export async function paneTail(paneId: string, lines = 30, machine?: string): Promise<string> {
  const args = ["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", String(lines)];
  return run(machine ? ["--machine", machine, ...args] : args);
}

/**
 * The same picture for a saved herdr machine, over `herdr --machine`.
 *
 * It reports what that machine's herdr knows -- workspaces, agents, panes --
 * and deliberately NOT "resumable". Resumable is derived from transcript files
 * under ~/.claude/projects, which live on that machine's disk; claiming it from
 * here would be a guess. A remote worktree is therefore running, open, or cold.
 */
export async function resolveMachine(nameOrId: string): Promise<string> {
  const all = (await machines()).filter((m) => m.enabled);
  const byId = all.find((m) => m.id === nameOrId);
  if (byId) return byId.id;
  const byLabel = all.filter((m) => m.label === nameOrId);
  if (byLabel.length === 1) return byLabel[0].id;
  if (byLabel.length > 1) {
    // herdr refuses an ambiguous label, and several profiles can share one
    throw new Error(
      `machine label "${nameOrId}" is ambiguous — ${byLabel
        .map((m) => `${m.target} (${m.id.slice(0, 8)})`)
        .join(", ")}. Pass a profile id.`,
    );
  }
  throw new Error(
    `no saved machine "${nameOrId}". Known: ${all.map((m) => m.label).join(", ")}`,
  );
}

export async function remoteTree(machine: string): Promise<Node[]> {
  const id = await resolveMachine(machine);
  const call = async (args: string[]) => {
    // no swallowing: a failure here is the answer to "why is the fleet empty"
    return JSON.parse(await run(["--machine", id, ...args])).result;
  };
  const [spaces, agentList, paneList] = await Promise.all([
    call(["workspace", "list"]),
    call(["agent", "list"]),
    call(["pane", "list"]),
  ]);
  if (!spaces) throw new Error(`machine ${machine} did not answer workspace list`);

  const agentByWorkspace = new Map<string, any>();
  for (const a of agentList?.agents ?? []) agentByWorkspace.set(a.workspace_id, a);
  const firstPaneByWorkspace = new Map<string, string>();
  for (const p of paneList?.panes ?? []) {
    if (!firstPaneByWorkspace.has(p.workspace_id)) {
      firstPaneByWorkspace.set(p.workspace_id, p.pane_id);
    }
  }

  return (spaces.workspaces ?? []).map((w: any): Node => {
    const agent = agentByWorkspace.get(w.workspace_id);
    return {
      kind: "worktree",
      repo: w.worktree?.repo_name ?? w.label,
      repoRoot: w.worktree?.repo_root ?? "",
      label: w.label,
      path: w.worktree?.checkout_path ?? agent?.cwd ?? `herdr:${w.workspace_id}`,
      linked: Boolean(w.worktree?.is_linked_worktree),
      state: agent ? "running" : "open",
      status: w.agent_status ?? "unknown",
      agent: agent?.agent,
      workspaceId: w.workspace_id,
      spaceNumber: w.number,
      paneId: agent?.pane_id ?? firstPaneByWorkspace.get(w.workspace_id),
      sessionId: agent?.agent_session?.value,
    };
  });
}

/** Act on a remote worktree. Only the space-level verbs cross the wire. */
export async function remoteAct(machine: string, verb: string, node: Node) {
  const m = ["--machine", await resolveMachine(machine)];
  if (verb === "open") {
    if (!node.workspaceId) throw new Error("no workspace to focus on that machine");
    await run([...m, "workspace", "focus", node.workspaceId]);
    return;
  }
  if (verb === "close") {
    if (!node.workspaceId) throw new Error("no open space to close");
    await run([...m, "workspace", "close", node.workspaceId]);
    return;
  }
  if (verb === "kill") {
    if (!node.paneId) throw new Error("nothing running there");
    await run([...m, "pane", "send-keys", node.paneId, "ctrl+c"]);
    await new Promise((r) => setTimeout(r, 250));
    await run([...m, "pane", "send-keys", node.paneId, "ctrl+c"]);
    return;
  }
  // start/resume need the remote transcript id, which only that machine can
  // resolve -- refuse rather than start a fresh agent and call it a resume
  throw new Error(
    `${verb} is local-only; a remote resume needs that machine's transcripts. ` +
      `Use open/close/kill across machines.`,
  );
}
