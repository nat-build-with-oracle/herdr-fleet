/** A status message that clears itself. An action's result used to be
 *  overwritten a moment later by the rescan it triggered ("scanning…" then
 *  nothing), so "kill — pulse" flashed and vanished. A note holds for a few
 *  seconds regardless of what the tree is doing. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../shared/StatusLine";

export function useNote(holdMs = 6_000) {
  const [note, setNote] = useState<Status | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string, kind?: Status["kind"], hold = true) => {
      if (timer.current) clearTimeout(timer.current);
      setNote({ text, kind });
      // a progress note ("kill pulse…") stays until its result replaces it
      if (hold) timer.current = setTimeout(() => setNote(null), holdMs);
    },
    [holdMs],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { note, show };
}
