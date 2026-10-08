/** Loads /api/compare for one machine, and reloads on demand.
 *
 *  A remote scan takes seconds, so switching machines twice quickly can land
 *  the first reply after the second. The request counter drops any reply that
 *  is no longer the one being waited on. */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCompare } from "./api";
import type { CompareData } from "./types";

export function useCompare(machineId?: string) {
  const [data, setData] = useState<CompareData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!machineId) return;
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const out = await fetchCompare(machineId);
      if (mine === seq.current) setData(out);
    } catch (e: any) {
      if (mine === seq.current) {
        setError(String(e?.message ?? e));
        setData(null);
      }
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [machineId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, busy, error, reload: load };
}
