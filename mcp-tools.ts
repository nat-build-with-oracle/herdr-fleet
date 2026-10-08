/**
 * The MCP tool surface, transport-free.
 *
 * Two transports serve this same registry:
 *   - server.ts mounts it at POST /mcp (streamable HTTP) so any number of
 *     clients — this machine, another oracle, a box across the mesh — talk to
 *     ONE process that already owns the scan cache and the event ring buffer.
 *   - mcp.ts wraps it on stdio, for clients that speak only stdio and for the
 *     auto-start path (a URL cannot boot a server; a spawned process can).
 *
 * Keeping the registry here is what stops the two from drifting: add a tool
 * once, both transports expose it.
 */
import {
  closeSpace,
  kill,
  openSpace,
  paneTail,
  remoteAct,
  paneClaude,
  remoteTree,
  restartPane,
  sendToPane,
  start,
  tree,
  type Node,
} from "./agents.ts";
import { compareMachines } from "./compare.ts";
import { machines } from "./hosts.ts";
import { resolveTarget } from "./target.ts";
import { commitSnapshot, restore, takeSnapshot } from "./snapshot.ts";
import { autoStatus, setAuto } from "./autosnap.ts";
import { buildReport } from "./report.ts";
import { herdr } from "./agents.ts";

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER_INFO = { name: "fleet", version: "0.2.0" };

/** Sent in the initialize reply; clients put it in front of every agent that
 *  connects. It exists because "restart" is ambiguous here -- an agent asked
 *  to "fleet restart self" once restarted the whole server instead of itself,
 *  and never picked up the token change it was restarted for. */
export const INSTRUCTIONS = `Fleet controls Claude agents in herdr panes, across git worktrees.

Vocabulary -- take these literally:
- "restart", "restart self", "fleet restart", "restart <name>" mean restart an AGENT:
  call fleet_restart_agent. With no target it restarts YOU, the calling agent: you
  quit and are resumed on the same session in the same pane, which is how you pick
  up a changed .envrc such as a new token from \`maw token use\`. Your reply will be
  cut off; that is expected.
- Only "restart the fleet server" / "restart the server" means fleet_server_restart.
  It restarts the web/API process, never any agent.

Targets for fleet_restart_agent and fleet_act: "self", a worktree name
("my-oracle"), a herdr pane id ("<pane>"), or an absolute path. An ambiguous name
returns its candidates; ask which one rather than guessing.

A message that arrives as <channel source="fleet" msg_id="..."> is from another agent or
a person who cannot see your terminal. Answer it with fleet_reply {msg_id, text}; your
normal output never reaches them. Replies to what YOU sent land in fleet_inbox.

To talk to another agent use fleet_send (then fleet_tail to read its reply) --
never \`herdr agent prompt <name>\`, which prefix-matches names and misdelivers.

kill and close stop another agent's work -- do not use them to test anything; pass
dry: true to see what a target resolves to.`;

export const TOOLS = [
  {
    name: "fleet_status",
    description:
      "Counts and the state of every git worktree on this machine: running (a Claude is live), open (herdr space open, no agent), resumable (a transcript exists to resume), cold (nothing). Scans worktrees, not just open herdr spaces, so closed-but-resumable work stays visible.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["running", "open", "resumable", "cold"],
          description: "Only return worktrees in this state.",
        },
        repo: { type: "string", description: "Only worktrees whose repo name contains this." },
        limit: { type: "number", description: "Max worktrees to return (default 40)." },
        json: {
          type: "boolean",
          description:
            "Return the raw worktree objects as JSON instead of the formatted table — for a caller that filters/sorts/joins the result itself rather than reading it.",
        },
        machine: {
          type: "string",
          description:
            "A saved herdr machine (label or profile id) to report on instead of this one. Remote rows are running/open/cold only — 'resumable' comes from transcripts on that machine's disk, which this host cannot read.",
        },
      },
    },
  },
  {
    name: "fleet_act",
    description:
      "Act on one worktree by absolute path. open = focus or create its herdr space; resume = start Claude on its newest transcript; start = fresh Claude; kill = ctrl-c twice (pane survives); close = close the herdr space (worktree and transcript stay); restart = quit the running agent and resume the same session in the same pane, picking up a changed .envrc (e.g. after `maw token use`) -- works on the calling agent itself, runs detached, returns before the kill.",
    inputSchema: {
      type: "object",
      properties: {
        verb: { type: "string", enum: ["open", "resume", "start", "kill", "close", "restart"] },
        target: {
          type: "string",
          description: "self, a worktree name, a herdr pane id, or an absolute path. Use this or path.",
        },
        path: { type: "string", description: "Absolute worktree path, from fleet_status." },
        dry: { type: "boolean", description: "Only report which worktree the target resolves to." },
        machine: {
          type: "string",
          description:
            "Act on a saved herdr machine instead of this one. Only open/close/kill cross the wire; resume/start need that machine's transcripts.",
        },
      },
      required: ["verb"],
    },
  },
  {
    name: "fleet_tail",
    description:
      "Recent terminal output of a live pane — what a running agent is doing right now. pane_id comes from fleet_status.",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "e.g. <pane>" },
        machine: { type: "string", description: "Read a pane on a saved herdr machine." },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "fleet_events",
    description:
      "State transitions observed across the fleet, newest first (repo/label, from -> to, when).",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "boolean", description: "Return raw event objects as JSON instead of formatted lines." },
      },
    },
  },
  {
    name: "fleet_restart_agent",
    description:
      "Restart an AGENT: quit it and resume the same session in the same pane. This is what 'restart', 'restart self' and 'fleet restart' mean. With no target it restarts the calling agent itself -- the way to pick up a changed .envrc (e.g. after `maw token use`); the call returns first and your reply is then cut off, which is expected. Agents only, never the server.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "self (default), a worktree name, a herdr pane id like <pane>, or an absolute path.",
        },
        dry: { type: "boolean", description: "Only report which agent the target resolves to." },
      },
    },
  },
  {
    name: "fleet_send",
    description:
      "Type a prompt into another running Claude agent and (by default) submit it -- how one agent talks to another, or a human talks to an agent from outside its pane. Addressed by exact pane, never by herdr agent name (names prefix-match and have misdelivered). Only into a pane with a Claude running. Multi-line text arrives as ONE prompt. Returns immediately; read the reply with fleet_tail.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "a worktree name, a herdr pane id like <pane>, or an absolute path. Not self." },
        text: { type: "string", description: "The prompt." },
        submit: { type: "boolean", description: "Press Enter after typing (default true). false leaves it in the input box." },
        dry: { type: "boolean", description: "Only report which agent would receive it." },
        via: {
          type: "string",
          enum: ["terminal", "channel"],
          description:
            "terminal (default): type it into the pane -- works for every running Claude. channel: push it through the target's fleet bridge as a claude/channel message, no typing. Only arrives if that Claude was started with the fleet channel enabled, which fleet cannot see from outside -- so it is opt-in until proven.",
        },
      },
      required: ["target", "text"],
    },
  },
  {
    name: "fleet_reply",
    description:
      "Answer a fleet message. A message that reached you as <channel source=\"fleet\" msg_id=\"...\"> came from another agent or a person, who reads NONE of your terminal output -- this tool is the only way your answer reaches them. Pass the msg_id from the tag. The reply goes to the sender's channel if they have one, to the web console if they wrote from there, and always into their fleet inbox (fleet_inbox).",
    inputSchema: {
      type: "object",
      properties: {
        msg_id: { type: "string", description: "The msg_id attribute of the <channel> message you are answering." },
        text: { type: "string", description: "Your reply." },
      },
      required: ["msg_id", "text"],
    },
  },
  {
    name: "fleet_inbox",
    description:
      "Messages addressed to you (your herdr pane): replies to what you sent with fleet_send via channel, and messages sent to you. Newest first. Use this if you are not channel-enabled -- nothing is pushed to you then.",
    inputSchema: {
      type: "object",
      properties: { since: { type: "number", description: "Only messages after this epoch-ms timestamp." } },
    },
  },
  {
    name: "fleet_watch",
    description:
      "Get told when another agent finishes: when its status goes from working to idle/done, you receive a note (over your channel if you have one, always in fleet_inbox) with the last lines of its terminal. One-shot by default. Use it instead of polling fleet_tail.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "a worktree name, a herdr pane id, or an absolute path. Not self." },
        once: { type: "boolean", description: "Stop after the first finish (default true). false: every time it finishes." },
        stop: { type: "boolean", description: "Stop watching this target." },
        list: { type: "boolean", description: "Only list current watches; target not needed." },
      },
    },
  },
  {
    name: "fleet_snapshot",
    description:
      "Record the fleet so it can be brought back: every running agent's pane, live session, exact argv and channel state, plus every resumable worktree. Writes ψ/memory/fleet/fleet.tsv (one line per agent: /herdr-pr fields + channel, token, argv), resumable.tsv, and fleet.md rendered from them -- git diff names the agent whose row changed; DuckDB reads the TSV directly. Take one before a reboot or a rollout.",
    inputSchema: {
      type: "object",
      properties: {
        commit: { type: "boolean", description: "Also git-commit the files, with a message summarising the change." },
        auto: {
          type: "string",
          enum: ["on", "off", "status"],
          description: "Snapshot automatically whenever the fleet changes (agent started/exited, pane or space opened/closed) -- committing only real row changes. Survives server restarts.",
        },
      },
    },
  },
  {
    name: "fleet_restore",
    description:
      "Bring the fleet back from a snapshot (default: the current fleet.tsv; rev for any committed one). Agents still running are left alone; a missing one is relaunched in its own pane with its own argv, or its worktree is resumed if the pane is gone. A PLAN unless go: true.",
    inputSchema: {
      type: "object",
      properties: {
        rev: { type: "string", description: "A git revision to restore from, e.g. HEAD~3; default the current fleet.tsv." },
        month: { type: "string", description: "YYYY-MM folder to read; default the newest month with a snapshot." },
        go: { type: "boolean", description: "Actually do it. Without this, only the plan is returned." },
      },
    },
  },
  {
    name: "fleet_report",
    description:
      "Draft the monthly fleet report (for a pulse-oracle discussion) from the month's snapshot history and the PRs merged that month. Writes ψ/memory/fleet/YYYY-MM/report.md and returns it. Does NOT post anything.",
    inputSchema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM; default this month." } } },
  },
  {
    name: "fleet_server_restart",
    description:
      "Restart the fleet SERVER process (web pages + API), not any agent. Use ONLY when explicitly asked to restart the fleet server, or after editing server/page code. Never use this for 'restart' or 'restart self' -- that is fleet_restart_agent.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fleet_diff",
    description:
      "Compare this machine's worktrees against a saved herdr machine, paired by repo and label, with a verdict on STATE: same, differs, unknowable (local resumable vs remote cold -- a remote cannot see its own transcripts), only here, only there. The same comparison as the web /compare page. Fails loudly if the machine cannot be reached or its label is ambiguous.",
    inputSchema: {
      type: "object",
      properties: {
        machine: { type: "string", description: "Machine label or profile id (required; labels can repeat -- pass the id then)." },
        all: { type: "boolean", description: "Include rows whose state is the same on both sides (hidden by default)." },
        json: { type: "boolean", description: "Return the raw comparison as JSON." },
      },
      required: ["machine"],
    },
  },
] as const;

/** The host supplies these so the registry never decides who owns the cache. */
export type ToolDeps = {
  /** maxAgeMs 0 forces a fresh scan -- used before acting, never on a stale view */
  getTree: (maxAgeMs?: number) => Promise<Node[]>;
  getEvents: () => { at: number; repo: string; label: string; from: string; to: string }[];
  invalidate: () => void;
  /** spawn a replacement server and exit this one; returns the new PID */
  restart: () => number;
  /** layer-1 hub, present only inside the server: hand a message to the
   *  bridge in a pane (false when none is connected), and list those panes */
  deliver?: (pane: string, msg: { id: string; text: string; from: string; fromPane?: string; at: number }) => boolean;
  bridgePanes?: () => string[];
  /** the rest of the hub: reply routing and per-pane inboxes */
  hub?: {
    noteSender: (id: string, fromPane?: string) => void;
    senderOf: (id: string) => { fromPane?: string } | undefined;
    file: (pane: string, msg: any) => void;
    inbox: (pane: string, since?: number) => any[];
    pushWeb: (msg: unknown) => void;
  };
  watch?: {
    add: (target: string, watcher: string | undefined, once?: boolean) => void;
    remove: (target: string, watcher: string | undefined) => void;
    list: () => { target: string; watchers: (string | undefined)[] }[];
  };
};

export async function callTool(name: string, args: any, deps: ToolDeps): Promise<string> {
  if (name === "fleet_status") {
    // a named machine bypasses the local cache entirely -- that cache and its
    // event feed describe THIS host, and mixing the two would be a lie
    const source = args?.machine ? await remoteTree(args.machine) : await deps.getTree();
    const worktrees = source.filter((n) => n.kind === "worktree");
    const counts: Record<string, number> = { running: 0, open: 0, resumable: 0, cold: 0 };
    for (const n of worktrees) counts[n.state] = (counts[n.state] ?? 0) + 1;

    let rows = worktrees;
    if (args?.state) rows = rows.filter((n) => n.state === args.state);
    if (args?.repo) {
      const needle = String(args.repo).toLowerCase();
      rows = rows.filter((n) => n.repo.toLowerCase().includes(needle));
    }
    rows = rows
      .slice()
      .sort((a, b) => (b.sessionAt ?? 0) - (a.sessionAt ?? 0))
      .slice(0, args?.limit ?? 40);

    if (args?.json) {
      return JSON.stringify(
        { machine: args?.machine ?? "local", total: worktrees.length, counts, rows },
        null,
        2,
      );
    }

    const where = args?.machine ? `${args.machine}: ` : "";
    return [
      `${where}${worktrees.length} worktrees — running ${counts.running} · open ${counts.open} · resumable ${counts.resumable} · cold ${counts.cold}`,
      "",
      ...rows.map((n) =>
        [
          n.state.padEnd(9),
          `${n.repo}/${n.label}`,
          n.branch ? `[${n.branch}]` : "",
          n.paneId ? `pane=${n.paneId}` : "",
          n.sessionBytes ? `${(n.sessionBytes / 1048576).toFixed(1)}MB` : "",
          n.path,
        ]
          .filter(Boolean)
          .join("  "),
      ),
    ].join("\n");
  }

  if (name === "fleet_act") {
    // the verb is checked before the target is looked up, so a typo says so
    // instead of surfacing as "no worktree"
    const KNOWN = ["open", "resume", "start", "kill", "close", "restart"];
    if (!KNOWN.includes(args?.verb)) throw new Error(`unknown verb ${args?.verb} -- one of ${KNOWN.join(", ")}`);
    if (args?.machine) {
      // "self" is never on another machine; a name, pane or path is
      const node = resolveTarget(await remoteTree(args.machine), args?.target ?? args?.path, undefined);
      if (args?.dry) return `would ${args?.verb} on ${args.machine}: ${node.repo}/${node.label}  ${node.path}`;
      await remoteAct(args.machine, args?.verb, node);
      return `${args.verb} ok on ${args.machine} — ${node.label}`;
    }
    const want = args?.target ?? args?.path ?? "self";

    // Restart is about a PANE, not a worktree. Two Claudes can share one
    // worktree (a fork in a split beside the original), and the worktree index
    // holds only one pane -- so "self" and pane ids go straight to the pane,
    // and only names and paths are looked up in the tree.
    if (args?.verb === "restart") {
      const pane =
        want === "self" ? args?.caller_pane
        : /^w\w+:p\w+$/.test(want) ? want
        : resolveTarget(await deps.getTree(0), want, args?.caller_pane).paneId;
      if (!pane) {
        throw new Error(want === "self"
          ? '"self" needs the caller\'s herdr pane and this call carried none -- name the target instead.'
          : `no pane for "${want}"`);
      }
      const c = await paneClaude(pane);
      if (!c) throw new Error(`no Claude running in pane ${pane}`);
      if (!c.sessionId) throw new Error(`cannot tell which session pid ${c.pid} in ${pane} is on -- not restarting blind`);
      // The name the relaunched agent gets in herdr. Keep the name it already
      // has; never derive one from the target string -- "self" would become
      // an agent literally named "self". herdr prefix-matches names when
      // addressing agents, so a name also must not collide with another
      // pane's; a pane-derived fallback cannot.
      const agents = JSON.parse(await herdr(["agent", "list"])).result?.agents ?? [];
      const current = agents.find((a: any) => a.pane_id === pane)?.name;
      const label = current || `claude-${pane.replace(":", "-").toLowerCase()}`;
      const ch = args?.channel === true ? ", channel ON" : args?.channel === false ? ", channel OFF" : "";
      if (args?.dry) return `would restart: pane ${pane}, pid ${c.pid}, session ${c.sessionId}, as agent "${label}"${ch}`;
      setTimeout(
        () =>
          restartPane(pane, label, { channel: args?.channel })
            .catch((e) => console.error(`restart ${pane} failed: ${e?.message ?? e}`))
            .finally(() => deps.invalidate()),
        300,
      );
      return `restart scheduled — pane ${pane} (pid ${c.pid}) quits and resumes session ${c.sessionId} with its own flags in ~2s`;
    }

    const node = resolveTarget(await deps.getTree(0), want, args?.caller_pane);
    if (args?.dry) return `would ${args?.verb}: ${node.repo}/${node.label}  ${node.paneId ?? ""}  ${node.path}`;
    const verbs: Record<string, () => Promise<void>> = {
      open: () => openSpace(node),
      start: () => start(node, false),
      resume: () => start(node, true),
      kill: () => kill(node),
      close: () => closeSpace(node),
    };
    const run = verbs[args?.verb];
    if (!run) throw new Error(`unknown verb ${args?.verb}`);
    await run();
    deps.invalidate();
    return `${args.verb} ok — ${node.label}`;
  }

  if (name === "fleet_tail") {
    if (!args?.pane_id) throw new Error("pane_id is required");
    const text = await paneTail(args.pane_id, 40, args?.machine);
    return text || "(empty)";
  }

  if (name === "fleet_events") {
    const events = deps.getEvents();
    if (args?.json) return JSON.stringify(events, null, 2);
    if (!events.length) return "No state changes observed yet.";
    return events
      .map(
        (e) =>
          `${new Date(e.at).toISOString().slice(11, 19)}  ${e.repo}/${e.label}  ${e.from} -> ${e.to}`,
      )
      .join("\n");
  }

  if (name === "fleet_restart_agent") {
    return callTool("fleet_act", { ...args, verb: "restart", target: args?.target ?? "self" }, deps);
  }

  if (name === "fleet_send") {
    const want = String(args?.target ?? "").trim();
    if (!want) throw new Error("target is required");
    if (want === "self") throw new Error("sending to yourself is just thinking -- name another agent");
    const pane = /^w\w+:p\w+$/.test(want) ? want : resolveTarget(await deps.getTree(0), want, args?.caller_pane).paneId;
    if (!pane) throw new Error(`no pane for "${want}"`);
    if (pane === args?.caller_pane) throw new Error(`${want} is your own pane -- name another agent`);
    const c = await paneClaude(pane);
    if (!c) throw new Error(`no Claude running in pane ${pane} -- not typing into it`);
    const where = `pane ${pane} (pid ${c.pid}, session ${c.sessionId ?? "?"})`;
    if (args?.dry) {
      const ch = deps.bridgePanes?.().includes(pane) ? "has a fleet bridge" : "no fleet bridge";
      return `would send ${String(args?.text ?? "").length} chars to ${where} (${ch})`;
    }
    if (args?.via === "channel") {
      if (!deps.deliver) throw new Error("channel delivery needs the fleet server (not direct mode)");
      const msg = { id: `f${Date.now().toString(36)}`, text: String(args?.text ?? ""), from: args?.caller_pane ? `agent in ${args.caller_pane}` : "fleet", fromPane: args?.caller_pane, at: Date.now() };
      if (!deps.deliver(pane, msg)) throw new Error(`no fleet bridge connected in pane ${pane} -- use via: "terminal"`);
      deps.hub?.noteSender(msg.id, args?.caller_pane);
      return `pushed to the fleet bridge in ${where} as channel message ${msg.id}. It shows up only if that Claude runs with the fleet channel enabled; check with fleet_tail ${pane}`;
    }
    const r = await sendToPane(pane, String(args?.text ?? ""), args?.submit !== false);
    const how = args?.submit === false ? "typed (not submitted)"
      : r.submitted ? "sent — the agent is working on it"
      : "sent — could not confirm the agent started (check the tail)";
    return `${how}: ${where}. Read the reply with fleet_tail ${pane}`;
  }

  if (name === "fleet_reply") {
    if (!deps.hub || !deps.deliver) throw new Error("replies need the fleet server (not direct mode)");
    const to = deps.hub.senderOf(String(args?.msg_id ?? ""));
    if (!to) throw new Error(`unknown msg_id ${args?.msg_id} -- only messages sent through fleet can be answered`);
    const reply = {
      id: `r${Date.now().toString(36)}`,
      text: String(args?.text ?? ""),
      from: args?.caller_pane ? `agent in ${args.caller_pane}` : "fleet",
      fromPane: args?.caller_pane,
      at: Date.now(),
      inReplyTo: String(args.msg_id),
    };
    if (!reply.text.trim()) throw new Error("empty reply");
    // a reply can itself be answered
    deps.hub.noteSender(reply.id, reply.fromPane);
    if (!to.fromPane) {
      // the message came from the web console or a script: answer there
      deps.hub.pushWeb({ type: "reply", reply });
      return `reply ${reply.id} sent to the web console`;
    }
    deps.hub.file(to.fromPane, reply);
    const pushed = deps.deliver(to.fromPane, reply);
    return pushed
      ? `reply ${reply.id} delivered to ${to.fromPane}'s channel (and its inbox)`
      : `reply ${reply.id} filed in ${to.fromPane}'s inbox -- that agent has no live channel, it reads it with fleet_inbox`;
  }

  if (name === "fleet_inbox") {
    if (!deps.hub) throw new Error("the inbox lives in the fleet server (not direct mode)");
    const pane = args?.caller_pane;
    if (!pane) throw new Error("fleet_inbox needs your herdr pane -- call it from an agent running in herdr");
    const msgs = deps.hub.inbox(pane, Number(args?.since ?? 0));
    if (!msgs.length) return `no messages for ${pane}`;
    return msgs
      .map((m: any) => `${new Date(m.at).toISOString().slice(11, 19)}  ${m.id}${m.inReplyTo ? ` (re ${m.inReplyTo})` : ""}  from ${m.from}:\n  ${m.text}`)
      .join("\n");
  }

  if (name === "fleet_watch") {
    if (!deps.watch) throw new Error("watching needs the fleet server (not direct mode)");
    if (args?.list) {
      const ws = deps.watch.list();
      return ws.length ? ws.map((w) => `${w.target}  <- ${w.watchers.map((x) => x ?? "web").join(", ")}`).join("\n") : "no watches";
    }
    const want = String(args?.target ?? "").trim();
    if (!want || want === "self") throw new Error("name the agent to watch (not self)");
    const pane = /^w\w+:p\w+$/.test(want) ? want : resolveTarget(await deps.getTree(0), want, args?.caller_pane).paneId;
    if (!pane) throw new Error(`no pane for "${want}"`);
    if (pane === args?.caller_pane) throw new Error("that is your own pane -- you will know when you are done");
    if (args?.stop) {
      deps.watch.remove(pane, args?.caller_pane);
      return `stopped watching ${pane}`;
    }
    deps.watch.add(pane, args?.caller_pane, args?.once !== false);
    const where = args?.caller_pane ? "your channel and fleet_inbox" : "the web console";
    return `watching ${pane} -- you will be told in ${where} when it goes from working to idle/done${args?.once === false ? " (every time)" : " (once)"}`;
  }

  if (name === "fleet_snapshot" && args?.auto) {
    return args.auto === "status" ? autoStatus() : setAuto(args.auto === "on");
  }

  if (name === "fleet_snapshot") {
    const { files, rows, resumable, unchanged } = await takeSnapshot();
    const on = rows.filter((r) => r.channel === "on").length;
    const head = unchanged
      ? `no change since the last snapshot (${rows.length} running) -- files left as they were`
      : `snapshot: ${rows.length} running (channel on for ${on}), ${resumable.length} resumable\n  ${files.tsv}\n  ${files.resumable}\n  ${files.md}`;
    return args?.commit ? `${head}\n${commitSnapshot(rows, resumable)}` : head;
  }

  if (name === "fleet_restore") {
    const out = await restore({ rev: args?.rev, month: args?.month, go: args?.go === true });
    if (args?.go) deps.invalidate();
    return out;
  }

  if (name === "fleet_report") {
    const d = new Date();
    const month = args?.month ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const { path, text } = await buildReport(month);
    return `draft written to ${path} -- not posted\n\n${text}`;
  }

  if (name === "fleet_server_restart") {
    const pid = deps.restart();
    return `fleet server restarting — pid ${process.pid} hands over to ${pid} on the same port and token. ` +
      `No agent was touched. The next call may take a second while it boots.`;
  }

  if (name === "fleet_diff") {
    if (!args?.machine) {
      const names = (await machines()).filter((m) => m.enabled).map((m) => `${m.label} (${m.target}, ${m.id.slice(0, 8)})`);
      throw new Error(`name a machine: ${names.join(", ")}`);
    }
    const c = await compareMachines(await deps.getTree(), args.machine);
    const saved = (await machines()).find((m) => m.id === args.machine || m.label === args.machine);
    if (args?.json) return JSON.stringify(c, null, 2);
    const GUT: Record<string, string> = { same: "=", differs: "\u2260", unknowable: "?", "only-left": "\u25C0", "only-right": "\u25B6" };
    const side = (s?: { state: string }) => (s ? s.state : "\u2014");
    const rows = c.rows.filter((r) => args?.all || r.verdict !== "same");
    return [
      `local \u21C4 ${saved ? `${saved.label} (${saved.target})` : c.machine}`,
      `= ${c.counts.same} same \u00B7 \u2260 ${c.counts.differs} differs \u00B7 ? ${c.counts.unknowable} unknowable \u00B7 \u25C0 ${c.counts.onlyLeft} only here \u00B7 \u25B6 ${c.counts.onlyRight} only there`,
      "",
      ...rows.map((r) => `${GUT[r.verdict]}  ${`${r.repo}/${r.label}`.padEnd(60)} ${side(r.left).padEnd(10)} ${side(r.right)}`),
    ].join("\n");
  }

  throw new Error(`unknown tool ${name}`);
}

/** One JSON-RPC request, one reply (or null for a notification). */
export async function handleRpc(req: any, deps: ToolDeps): Promise<any | null> {
  const { id, method, params } = req ?? {};
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return isNotification
      ? null
      : {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            // claude/channel lets the bridge push messages in. A Claude not
            // started with the fleet channel enabled ignores them, so declaring
            // it costs nothing there.
            capabilities: { tools: {}, experimental: { "claude/channel": {} } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          },
        };
  }
  if (method?.startsWith("notifications/")) return null;
  if (method === "ping") return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    return isNotification ? null : { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    if (isNotification) return null;
    try {
      const text = await callTool(params?.name, params?.arguments ?? {}, deps);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (e: any) {
      // a tool failure is a result the model should see, not a transport error
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `error: ${e?.message ?? e}` }], isError: true },
      };
    }
  }
  if (isNotification) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
}
