/** The machine list and a cursor over it.
 *
 *  A cursor rather than a selected id because labels repeat: two saved
 *  profiles are both labelled "dev" (two different hosts), so the
 *  label cannot identify one. The index picks, the id travels. */
import { useCallback, useEffect, useState } from "react";
import { fetchMachines } from "./api";
import type { Machine } from "./types";

export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMachines()
      .then((ms) => live && setMachines(ms))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, []);

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => (machines.length ? (i + delta + machines.length) % machines.length : 0)),
    [machines.length],
  );

  return { machines, index, setIndex, step, error, current: machines[index] ?? null };
}
