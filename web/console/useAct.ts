/** Runs one verb against one worktree: confirm the destructive ones, mark the
 *  button busy, report the outcome, then re-read the tree so the row shows
 *  its new state. */
import { useCallback, useState } from "react";
import type { Node } from "../shared/types";
import { act } from "./api";
import type { Verb } from "./types";

type Report = (text: string, kind?: "error" | "ok", hold?: boolean) => void;

const CONFIRM: Partial<Record<Verb, (n: Node) => string>> = {
  kill: (n) => `kill ${n.label}?`,
  restart: (n) =>
    `restart ${n.label}?\n\nIt quits and resumes the same session in the same pane, keeping its flags ` +
    `and picking up any change to .envrc. A turn in progress is cancelled.`,
  close: (n) => `close ${n.label}?\n\nThe worktree and its transcript stay.`,
};

export function useAct(report: Report, reload: (fresh: boolean) => Promise<void>) {
  /** `${verb}\0${path}` of the action in flight, so exactly one button spins */
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (verb: Verb, node: Node) => {
      const ask = CONFIRM[verb];
      if (ask && !window.confirm(ask(node))) return;
      setBusy(verb + "\u0000" + node.path);
      report(`${verb} ${node.label}…`, undefined, false);
      try {
        await act(verb, node.path);
        report(`${verb} — ${node.label}`, "ok");
      } catch (e: any) {
        report(`${verb} failed — ${e?.message ?? e}`, "error");
      } finally {
        setBusy(null);
      }
      await reload(true);
    },
    [report, reload],
  );

  const isBusy = useCallback(
    (verb: Verb, node: Node) => busy === verb + "\u0000" + node.path,
    [busy],
  );

  return { run, isBusy };
}
