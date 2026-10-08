/** Run a callback every `ms` while the tab is visible. A hidden tab polling a
 *  herdr socket every few seconds is load nobody is looking at. */
import { useEffect, useRef } from "react";

export function useVisibleInterval(fn: () => void, ms: number) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) latest.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
