#!/usr/bin/env bun
/**
 * agents-tui -- every worktree on this machine, with Claude Code on it.
 *
 *   bun run tools/fleet-tui/agents-tui.tsx
 *
 * Scanned from the worktrees, not the open herdr spaces, because closing a
 * space hides work without destroying it: 220 worktrees here, 20 open spaces.
 * Cold worktrees are hidden by default -- press a for all of them.
 *
 * keys  j/k move · enter open the space · s start Claude · r resume its last
 *       session · e restart (quit + resume the same session, same pane, same
 *       flags -- picks up a changed .envrc) · K kill (pane survives) · x close
 *       the space (worktree and transcript stay) · a show cold · R rescan · q quit
 *
 * Restart, close and kill ask first. Every verb runs the fleet_act tool, the
 * same code the console, the fleet CLI and MCP clients run.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { act as runVerb, loadTree, source } from "./client.ts";
import { type Node, type State } from "./agents.ts";

const ICON: Record<State, string> = {
  running: "◐",
  open: "○",
  resumable: "↻",
  cold: "·",
};
const COLOUR: Record<State, string> = {
  running: "yellow",
  open: "green",
  resumable: "cyan",
  cold: "gray",
};

type Pending = { verb: "close" | "kill" | "restart"; node: Node } | null;

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    rows: stdout?.rows ?? 30,
    cols: stdout?.columns ?? 100,
  });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize({ rows: stdout.rows, cols: stdout.columns });
    stdout.on("resize", onResize);
    onResize();
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState("scanning…");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [showCold, setShowCold] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const t0 = Date.now();
    try {
      const t = await loadTree(true);
      setNodes(t);
      setStatus(`${t.filter((n) => n.kind === "worktree").length} worktrees in ${Date.now() - t0}ms`);
    } catch (e: any) {
      setStatus(String(e?.message ?? e));
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = showCold ? nodes : nodes.filter((n) => n.state !== "cold");
  // a repo whose every worktree was filtered out is just a bare heading
  const shown = filtered.filter((n, i) =>
    n.kind !== "repo" ? true : filtered[i + 1] && filtered[i + 1].kind !== "repo",
  );

  const maxSel = Math.max(0, shown.length - 1);
  const clamped = Math.min(sel, maxSel);
  const current = shown[clamped];

  const act = useCallback(
    async (verb: string, node: Node) => {
      setBusy(true);
      setStatus(`${verb} ${node.label}…`);
      try {
        // the tool's own words -- for restart they say which pane and session
        setStatus(await runVerb(verb, node));
        await load();
      } catch (e: any) {
        setStatus(`${verb} failed: ${String(e?.message ?? e)}`);
        setBusy(false);
      }
    },
    [load],
  );

  useInput((input, key) => {
    if (pending) {
      if (input === "y") {
        const { verb, node } = pending;
        setPending(null);
        void act(verb, node);
      } else if (input === "n" || key.escape) {
        setPending(null);
        setStatus("cancelled");
      }
      return;
    }
    if (input === "q" || (key.ctrl && input === "c")) return exit();
    if (input === "j" || key.downArrow) return setSel((s) => Math.min(s + 1, maxSel));
    if (input === "k" || key.upArrow) return setSel((s) => Math.max(s - 1, 0));
    if (input === "g") return setSel(0);
    if (input === "G") return setSel(maxSel);
    if (input === "R") return void load();
    if (input === "a") {
      setShowCold((v) => !v);
      return setSel(0);
    }
    if (!current || current.kind === "repo") return;
    if (key.return) return void act("open", current);
    if (input === "s") return void act("start", current);
    if (input === "r") {
      if (!current.sessionId) return setStatus("no transcript to resume for this worktree");
      return void act("resume", current);
    }
    if (input === "e") {
      if (current.state !== "running") return setStatus("nothing running here to restart");
      return setPending({ verb: "restart", node: current });
    }
    if (input === "K") {
      if (current.state !== "running") return setStatus("nothing running here");
      return setPending({ verb: "kill", node: current });
    }
    if (input === "x") {
      if (!current.workspaceId) return setStatus("no open space to close");
      return setPending({ verb: "close", node: current });
    }
  });

  const bodyHeight = Math.max(4, size.rows - 4);
  const top = Math.min(
    Math.max(0, clamped - Math.floor(bodyHeight / 2)),
    Math.max(0, shown.length - bodyHeight),
  );
  const view = shown.slice(top, top + bodyHeight);

  const worktrees = nodes.filter((n) => n.kind === "worktree");
  const count = (s: State) => worktrees.filter((n) => n.state === s).length;

  return (
    <Box flexDirection="column" height={size.rows - 1}>
      {/* one truncating Text: sibling Texts in a Box get shrunk individually,
          which eats digits out of the counts on a narrow pane */}
      <Box>
        <Text wrap="truncate">
          <Text bold color="#64b5f6"> claude </Text>
          <Text color="yellow">{`◐${count("running")} `}</Text>
          <Text color="green">{`○${count("open")} `}</Text>
          <Text color="cyan">{`↻${count("resumable")} `}</Text>
          <Text dimColor>{`·${count("cold")} `}</Text>
          {busy ? <Text color="yellow">working</Text> : <Text dimColor>idle</Text>}
          <Text dimColor>{showCold ? "  [all]" : "  [active]"}</Text>
          <Text dimColor>{`  ${source}`}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {view.map((n, i) => {
          const selected = top + i === clamped;
          if (n.kind === "repo") {
            const kids = worktrees.filter((w) => w.repoRoot === n.repoRoot);
            return (
              <Text key={`r-${n.repoRoot}-${i}`} bold color="#64b5f6" inverse={selected}>
                {` ${ICON[n.state]} ${n.repo} `}
                <Text dimColor>{`${kids.length}`}</Text>
              </Text>
            );
          }
          const indent = n.linked ? "     " : "   ";
          const showBranch = size.cols >= 78;
          const tagWidth = 10;
          const branchWidth = showBranch ? 24 : 0;
          const fixed = indent.length + 2 + 1 + tagWidth + (showBranch ? branchWidth + 1 : 0);
          const room = Math.max(8, Math.min(44, size.cols - fixed - 1));
          return (
            <Box key={`w-${n.path}-${i}`}>
              <Text inverse={selected}>
                {indent}
                <Text color={COLOUR[n.state]}>{ICON[n.state]}</Text>
                {` ${n.label.padEnd(room).slice(0, room)} `}
                <Text color={COLOUR[n.state]}>{n.state.padEnd(tagWidth).slice(0, tagWidth)}</Text>
                {showBranch ? (
                  <Text dimColor>{(n.branch ?? "").padEnd(branchWidth).slice(0, branchWidth)}</Text>
                ) : null}
              </Text>
            </Box>
          );
        })}
      </Box>

      {pending ? (
        <Box>
          <Text color="red" bold>
            {` ${pending.verb} ${pending.node.label}${pending.verb === "close" ? " (worktree kept)" : pending.verb === "restart" ? " (quit + resume same session; a turn in progress is cancelled)" : ""}? `}
          </Text>
          <Text bold>y/n</Text>
        </Box>
      ) : (
        <Box>
          <Text dimColor wrap="truncate">
            {` ⏎ open · s start · r resume · K kill · x close · a ${showCold ? "active" : "all"} · R rescan · q quit${status ? ` — ${status}` : ""}`}
          </Text>
        </Box>
      )}
    </Box>
  );
}

render(<App />);
