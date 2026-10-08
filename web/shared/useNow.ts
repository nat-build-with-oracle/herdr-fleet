/** A clock that ticks, so ages on screen do not quietly freeze at whatever
 *  they were when the data arrived. One minute is finer than any age this
 *  page prints, and costs one render. */
import { useEffect, useState } from "react";

export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
