#!/usr/bin/env bun
/**
 * fleet — the MCP tools, from a shell.
 *
 *   fleet ls [running|open|resumable|cold] [--repo X] [--machine M] [--json]
 *   fleet restart [target] [--channel|--no-channel]
 *                             quit + resume an agent in its own pane; --channel
 *                             turns the fleet channel on (warning auto-accepted)
 *   fleet <open|resume|start|kill|close> [target]
 *
 *   --dry prints which worktree a target resolves to, and does nothing else.
 *
 *   target is any of:
 *     self          the pane you are typing in (the default) -- from Claude's
 *                   `!` prompt, that is this very session
 *     /abs/path     a worktree path, or `.`
 *     <pane>        a herdr pane id
 *     my-oracle a worktree name; exact label first, then a repo's main
 *                   worktree, then a unique substring. Ambiguous names list
 *                   the candidates instead of guessing.
 *   fleet send <target> <text…> [--no-enter] [--dry]
 *                             type a prompt into a running agent (by pane,
 *                             never by name); multi-line stays one prompt
 *   fleet watch <target> [--every] | --list | <target> --stop
 *                             get told when an agent finishes (lands in your
 *                             inbox; see fleet inbox)
 *   fleet inbox               messages and watch notes for this pane
 *   fleet snapshot [--commit] record running agents (session, argv, channel)
 *   fleet snapshot --auto on|off|status
 *                             snapshot + commit by itself whenever the fleet changes
 *                             into ψ/memory/fleet/fleet.tsv (+ .md); git diff it
 *   fleet restore [--month YYYY-MM] [--rev <git rev>] [--go]
 *                             bring back what is missing; plan unless --go
 *   fleet report [YYYY-MM]    draft the monthly report (not posted)
 *   fleet tail <pane>         e.g. fleet tail my-oracle
 *   fleet events              recent state changes
 *   fleet diff [machine]      this machine vs a saved herdr machine
 *   fleet server-restart      hand the server over to a fresh copy
 *   fleet audit [--host H] [--json|--tsv] [--min-age 3] [--idle-shells] [--repo X] [--skip X]
 *                             every git worktree on this machine (or on ssh host H),
 *                             sorted into A ghost / B merged / C stale / D unsaved / K keep
 *   fleet clean [--host H] [--tier A,B,C] [--pr] [--idle-shells] [--go]
 *                             act on the audit: prune A, remove B and C (nothing is
 *                             lost); --tier D also commits unsaved work to rescue/<wt>,
 *                             pushes it (--pr: signed draft PR) and then removes.
 *                             Prints the plan unless --go. See worktrees.ts.
 *                             --idle-agents / --pick <wt,...> also close ✓ agents' spaces
 *   fleet sync [--host H] [--all] [--go]
 *                             fast-forward checkouts that are only behind upstream
 *                             (the sidebar's main ↓N); clean + not diverged only
 *
 * Every command is one tools/call against the running server's /mcp, so the
 * output is exactly what an agent sees from the fleet MCP. The token comes
 * from the server's own .tmp/runtime.json; nothing is passed on the command
 * line where `ps` could read it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HERE = import.meta.dir;
const VERBS = ["open", "resume", "start", "kill", "close", "restart"];
const STATES = ["running", "open", "resumable", "cold"];

function runtime(): { port: number; token: string } {
  try {
    return JSON.parse(readFileSync(`${HERE}/.tmp/runtime.json`, "utf8"));
  } catch {
    console.error("no fleet server is running (no .tmp/runtime.json). start one: bun run server (in your herdr-fleet checkout)");
    process.exit(1);
  }
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const rt = runtime();
  const r = await fetch(`http://127.0.0.1:${rt.port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fleet-token": rt.token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }).catch(() => null);
  if (!r) {
    console.error(`fleet server not answering on :${rt.port}. start one: bun run server (in your herdr-fleet checkout)`);
    process.exit(1);
  }
  const out = await r.json();
  const text = out?.result?.content?.[0]?.text ?? out?.error?.message ?? JSON.stringify(out);
  if (out?.result?.isError || out?.error) {
    console.error(text);
    process.exit(1);
  }
  return text;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** A path argument becomes absolute here; "self", names and pane ids are
 *  resolved by the server (target.ts), the same way the MCP tools resolve them. */
function targetArg(t: string | undefined): string {
  if (!t || t === "self") return "self";
  if (t === ".") {
    try {
      return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return process.cwd();
    }
  }
  if (t.startsWith("~")) return t.replace(/^~/, process.env.HOME ?? "~");
  return t;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** audit/clean run worktrees.ts directly, not through the server: a full audit fetches
 *  every repo and can take minutes. --host pipes the same file to `bun run -` over ssh,
 *  so the far machine needs bun, git, gh and ghq but nothing of fleet. */
async function worktrees(cmd: string, argv: string[]): Promise<number> {
  const host = flag(argv, "--host");
  const args = [cmd, ...argv.filter((a, i) => a !== "--host" && argv[i - 1] !== "--host")];
  const pane = process.env.HERDR_PANE_ID;
  let session = "";
  try { session = JSON.parse(execFileSync("herdr", ["pane", "get", pane ?? ""], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).result.pane.agent_session?.value ?? ""; } catch {}
  const top = targetArg(".");
  const sign: Record<string, string> = {
    FLEET_SIGN_WHO: `${top.split("/").slice(-3).join("/")} (${process.env.USER}@${execFileSync("hostname", ["-s"], { encoding: "utf8" }).trim()})`,
    FLEET_SIGN_PANE: pane ?? "",
    FLEET_SIGN_SESSION: session,
    FLEET_SIGN_TRANSCRIPT: session ? `${process.env.HOME}/.claude/projects/${top.replace(/^\//, "-").replace(/[/.]/g, "-")}/${session}.jsonl` : "",
    FLEET_SIGN_MODEL: process.env.FLEET_SIGN_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude",
  };
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  const proc = host
    ? Bun.spawn(["ssh", host, `bash -lc ${q(`${Object.entries(sign).map(([k, v]) => `${k}=${q(v)}`).join(" ")} bun run - ${args.map(q).join(" ")} 2> >(grep -v 'go: command' >&2)`)}`],
        { stdin: Bun.file(`${HERE}/worktrees.ts`), stdout: "inherit", stderr: "inherit" })
    : Bun.spawn(["bun", `${HERE}/worktrees.ts`, ...args], { env: { ...process.env, ...sign }, stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  console.log(readFileSync(import.meta.path, "utf8").split("*/")[0].split("\n").slice(3).map((l) => l.replace(/^ \* ?/, "")).join("\n").trim());
} else if (cmd === "ls" || cmd === "status") {
  const state = rest.find((a) => STATES.includes(a));
  console.log(
    await call("fleet_status", {
      state,
      repo: flag(rest, "--repo"),
      machine: flag(rest, "--machine"),
      json: rest.includes("--json") || undefined,
      limit: Number(flag(rest, "--limit") ?? 200),
    }),
  );
} else if (VERBS.includes(cmd)) {
  const machine = flag(rest, "--machine");
  const target = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--machine");
  console.log(
    await call("fleet_act", {
      verb: cmd,
      target: targetArg(target),
      machine,
      dry: rest.includes("--dry") || undefined,
      channel: rest.includes("--channel") ? true : rest.includes("--no-channel") ? false : undefined,
      // what "self" means: the pane this shell runs in
      caller_pane: process.env.HERDR_PANE_ID,
    }),
  );
} else if (cmd === "send") {
  const [target, ...words] = rest.filter((a) => !["--no-enter", "--dry"].includes(a));
  if (!target || !words.length) fail("usage: fleet send <target> <text…>");
  console.log(
    await call("fleet_send", {
      target: targetArg(target),
      text: words.join(" "),
      submit: !rest.includes("--no-enter"),
      dry: rest.includes("--dry") || undefined,
      caller_pane: process.env.HERDR_PANE_ID,
    }),
  );
} else if (cmd === "watch") {
  const target = rest.find((a) => !a.startsWith("--"));
  console.log(
    await call("fleet_watch", {
      target: target ? targetArg(target) : undefined,
      once: !rest.includes("--every"),
      stop: rest.includes("--stop") || undefined,
      list: rest.includes("--list") || undefined,
      caller_pane: process.env.HERDR_PANE_ID,
    }),
  );
} else if (cmd === "inbox") {
  console.log(await call("fleet_inbox", { caller_pane: process.env.HERDR_PANE_ID }));
} else if (cmd === "snapshot") {
  console.log(await call("fleet_snapshot", { commit: rest.includes("--commit") || undefined, auto: flag(rest, "--auto") }));
} else if (cmd === "restore") {
  console.log(await call("fleet_restore", { rev: flag(rest, "--rev"), month: flag(rest, "--month"), go: rest.includes("--go") || undefined }));
} else if (cmd === "report") {
  console.log(await call("fleet_report", { month: rest.find((a) => /^\d{4}-\d{2}$/.test(a)) }));
} else if (cmd === "tail") {
  if (!rest[0]) (console.error("usage: fleet tail <pane>"), process.exit(1));
  console.log(await call("fleet_tail", { pane_id: rest[0], machine: flag(rest, "--machine") }));
} else if (cmd === "events") {
  console.log(await call("fleet_events"));
} else if (cmd === "diff") {
  console.log(await call("fleet_diff", { machine: rest[0] }));
} else if (cmd === "audit" || cmd === "clean" || cmd === "sync") {
  process.exit(await worktrees(cmd, rest));
} else if (cmd === "server-restart") {
  console.log(await call("fleet_server_restart"));
} else {
  console.error(`unknown command "${cmd}". fleet help`);
  process.exit(1);
}
