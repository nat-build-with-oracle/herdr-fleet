/** Bind a key for as long as a component is mounted.
 *
 *  Plain keys (arrows) are ignored while the user is typing in a field --
 *  otherwise stepping machines would fight moving the cursor in the filter.
 *  Chorded keys (Cmd/Ctrl+K) fire regardless: a modifier is never typing. */
import { useEffect } from "react";

type Opts = { meta?: boolean; enabled?: boolean };

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
}

export function useHotkey(key: string, handler: () => void, opts: Opts = {}) {
  const { meta = false, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const chord = e.metaKey || e.ctrlKey;
      if (meta !== chord || e.altKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (!meta && isTyping(e.target)) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, meta, enabled]);
}
