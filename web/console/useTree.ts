/** The worktree tree: loaded on mount, re-read every 15s while visible, and
 *  on demand. `fresh` bypasses the server's 4s scan cache -- used by rescan
 *  and after an action, where a cached answer would show the old state.
 *
 *  The interval and a manual rescan can overlap; a counter drops any reply
 *  that is no longer the newest request. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Node } from "../shared/types";
import { fetchTree } from "./api";
import { useVisibleInterval } from "./useVisibleInterval";

export function useTree() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scannedAt, setScannedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const out = await fetchTree(fresh);
      if (mine !== seq.current) return;
      setNodes(out.nodes);
      setScannedAt(Date.now());
      setLoaded(true);
      setError(null);
    } catch (e: any) {
      if (mine === seq.current) setError(String(e?.message ?? e));
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);
  useVisibleInterval(() => void load(false), 15_000);

  return { nodes, loaded, scannedAt, busy, error, reload: load };
}
