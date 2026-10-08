#!/usr/bin/env bun
/**
 * fleet-tui -- two machines, one screen.
 *
 *   bun run tools/fleet-tui/fleet-tui.tsx [--right <machine-label-or-id>]
 *
 * Left is this machine, right is a saved herdr machine -- the same comparison
 * as the web /compare page and fleet_diff (compare.ts): worktrees paired by
 * repo + label, each with its state, and a verdict in the gutter.
 *   =  same   ≠ differs   ? unknowable   ◀ only here   ▶ only there
 * A machine that cannot be read shows its error; it is never an empty side.
 *
 * keys  j/k or arrows move - g/G top/bottom - d only the differences
 *       r refresh - q quit
 */
import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { tree, type State } from "./agents.ts";
import { compareMachines, type CompareRow, type Side } from "./compare.ts";
import { machines, type Machine } from "./hosts.ts";

// the herdr sidebar's four marks, as on every other fleet surface
const MARK: Record<State, string> = { running: "\u25D0", open: "\u25CB", resumable: "\u21BB", cold: "\u00B7" };
const MARK_COLOUR: Record<State, string> = { running: "yellow", open: "green", resumable: "cyan", cold: "gray" };
const GUT: Record<string, [string, string]> = {
  same: ["=", "gray"],
  differs: ["\u2260", "yellow"],
  unknowable: ["?", "magenta"],
  "only-left": ["\u25C0", "yellow"],
  "only-right": ["\u25B6", "cyan"],
};

type Line = { header: true; repo: string } | ({ header?: false } & CompareRow);

function pad(s: string, w: number) {
  const t = [...s];
  return t.length > w ? t.slice(0, Math.max(0, w - 1)).join("") + "…" : s + " ".repeat(w - t.length);
}

function Cell({ side, label, width, dim }: { side?: Side; label: string; width: number; dim: boolean }) {
  if (!side) return <Text>{" ".repeat(width)}</Text>;
  const indent = side.linked ? "  " : " ";
  // a narrow split has no room for the state word; the mark carries it
  const tail = width >= 30 ? side.state : "";
  const room = Math.max(4, width - indent.length - 2 - (tail ? tail.length + 1 : 0));
  return (
    <Text dimColor={dim}>
      {indent}
      <Text color={MARK_COLOUR[side.state]}>{MARK[side.state]}</Text>
      {` ${pad(label, room)}`}
      {tail ? <Text color={MARK_COLOUR[side.state]}>{` ${tail}`}</Text> : null}
    </Text>
  );
}

function App({ rightArg }: { rightArg?: string }) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Ink re-renders on state change, not on SIGWINCH, so a resize would
  // otherwise keep both columns at whatever width the pane had at launch.
  const [size, setSize] = useState({
    rows: stdout?.rows ?? 30,
    cols: stdout?.columns ?? 120,
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
  const { rows, cols } = size;

  const [right, setRight] = useState<Machine | null>(null);
  const [rowsAll, setRowsAll] = useState<CompareRow[]>([]);
  const [status, setStatus] = useState("loading\u2026");
  const [sel, setSel] = useState(0);
  const [diffOnly, setDiffOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const enabled = (await machines()).filter((m) => m.enabled);
      // no argument: the first saved machine, by id -- a label could be ambiguous
      const pickedArg = rightArg ?? enabled[0]?.id;
      if (!pickedArg) throw new Error("no saved herdr machine to compare against");
      setRight(enabled.find((m) => m.id === pickedArg || m.label === pickedArg) ?? null);
      const c = await compareMachines(await tree(), pickedArg);
      setRowsAll(c.rows);
      setStatus(`= ${c.counts.same} \u2260 ${c.counts.differs} ? ${c.counts.unknowable} \u25C0 ${c.counts.onlyLeft} \u25B6 ${c.counts.onlyRight}`);
    } catch (e: any) {
      // shown, not swallowed: an unreadable machine is not an empty one
      setRowsAll([]);
      setStatus(String(e?.message ?? e).split("\n")[0]!.slice(0, 200));
    }
    setBusy(false);
  }, [rightArg]);

  useEffect(() => {
    void load();
  }, [load]);

  const kept = diffOnly ? rowsAll.filter((r) => r.verdict !== "same") : rowsAll;
  const shown: Line[] = [];
  for (const r of kept) {
    const prev = shown[shown.length - 1];
    if (!prev || prev.repo !== r.repo) shown.push({ header: true, repo: r.repo });
    shown.push(r);
  }

  const bodyHeight = Math.max(4, rows - 5);
  const gutter = 3;
  const cellWidth = Math.max(16, Math.floor((cols - gutter - 2) / 2));

  const maxSel = Math.max(0, shown.length - 1);
  const clamped = Math.min(sel, maxSel);
  const start = Math.min(
    Math.max(0, clamped - Math.floor(bodyHeight / 2)),
    Math.max(0, shown.length - bodyHeight),
  );
  const view = shown.slice(start, start + bodyHeight);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) return exit();
    if (input === "j" || key.downArrow) setSel((s) => Math.min(s + 1, maxSel));
    else if (input === "k" || key.upArrow) setSel((s) => Math.max(s - 1, 0));
    else if (input === "g") setSel(0);
    else if (input === "G") setSel(maxSel);
    else if (input === "d") {
      setDiffOnly((d) => !d);
      setSel(0);
    } else if (input === "r") void load();
  });

  return (
    <Box flexDirection="column" height={rows - 1}>
      <Box>
        <Text bold color="#64b5f6"> fleet </Text>
        <Text dimColor>{`local ⇄ ${right?.label ?? "(no machine)"} `}</Text>
        {busy ? <Text color="yellow">● working</Text> : <Text dimColor>○ idle</Text>}

      </Box>

      <Box>
        <Text bold>{pad(" local", cellWidth)}</Text>
        <Text dimColor>{" │ "}</Text>
        <Text bold>{pad(` ${right?.target ?? "-"}`, cellWidth)}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {view.map((row, i) => {
          const index = start + i;
          const selected = index === clamped;
          if (row.header) {
            return (
              <Box key={`h-${row.repo}-${i}`}>
                <Text bold color="#64b5f6" inverse={selected}>
                  {pad(row.repo, cellWidth)}
                </Text>
                <Text dimColor>{"   "}</Text>
                <Text bold color="#64b5f6">{pad(row.repo, cellWidth)}</Text>
              </Box>
            );
          }
          const [mark, markColour] = GUT[row.verdict] ?? ["\u2502", "gray"];
          return (
            <Box key={`r-${row.repo}-${row.label}-${i}`}>
              <Box width={cellWidth}>
                <Text inverse={selected}>
                  <Cell side={row.left} label={row.label} width={cellWidth} dim={!row.right} />
                </Text>
              </Box>
              <Text color={markColour}>{` ${mark} `}</Text>
              <Box width={cellWidth}>
                <Text inverse={selected}>
                  <Cell side={row.right} label={row.label} width={cellWidth} dim={!row.left} />
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor wrap="truncate">
          {` j/k move · d ${diffOnly ? "all" : "diff only"} · r refresh · q quit — ${status}`}
        </Text>
      </Box>
    </Box>
  );
}

const argv = process.argv.slice(2);
const rightIndex = argv.indexOf("--right");
const rightArg = rightIndex >= 0 ? argv[rightIndex + 1] : process.env.FLEET_RIGHT;

render(<App rightArg={rightArg} />);
