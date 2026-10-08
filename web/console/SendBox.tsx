/** Talk to a running agent from its live tail: type, press Enter, watch the
 *  reply arrive in the terminal above. Shift+Enter is a new line; the whole
 *  thing still lands as one prompt (see sendToPane). Addressed by pane id. */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { send } from "./api";

type Props = { pane: string; label: string };

export function SendBox({ pane, label }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await send(pane, text);
      setNote({ text: `sent to ${label} \u2014 reply appears above` });
      setText("");
    } catch (e: any) {
      setNote({ text: String(e?.message ?? e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void go();
    }
  };

  return (
    <div className="col-span-full mt-1 flex items-start gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={Math.min(6, Math.max(1, text.split("\n").length))}
        placeholder={`message ${label}\u2026  (Enter sends \u00B7 Shift+Enter new line)`}
        aria-label={`Send a prompt to ${label}`}
        disabled={busy}
        className={
          "min-w-0 flex-1 resize-none rounded border border-rule bg-paper px-3 py-2 font-mono text-xs " +
          "text-ink placeholder:text-muted outline-2 outline-transparent outline-offset-1 " +
          "focus-visible:border-accent focus-visible:outline-focus disabled:text-muted"
        }
      />
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy || !text.trim()}
        aria-busy={busy || undefined}
        className={
          "shrink-0 cursor-pointer rounded border border-rule bg-paper-2 px-3 py-2 font-mono text-xs text-ink-2 " +
          "enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:text-muted " +
          "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 max-sm:min-h-11"
        }
      >
        send {"\u21B5"}
      </button>
      {note && (
        <span role="status" className={"basis-full text-xs " + (note.error ? "text-danger" : "text-open")}>
          {note.text}
        </span>
      )}
    </div>
  );
}
