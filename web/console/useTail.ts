/** The recent output of one pane, re-read every 2.5s for as long as the
 *  component asking for it is mounted. Collapsing the row unmounts it, which
 *  is what stops the polling -- no timer bookkeeping keyed by path. */
import { useEffect, useState } from "react";
import { fetchTail } from "./api";

export function useTail(pane: string): string {
  const [text, setText] = useState("loading…");

  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const t = await fetchTail(pane);
        if (live) setText(t || "(empty)");
      } catch (e: any) {
        if (live) setText(`(${e?.message ?? e})`);
      }
    };
    void read();
    const id = setInterval(read, 2_500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pane]);

  return text;
}
