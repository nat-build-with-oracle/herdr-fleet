/** ⌘K: jump to a worktree. A native <dialog> opened with showModal(), so the
 *  focus trap, Esc-to-close and the inert page behind it come from the
 *  platform instead of hand-rolled JS. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Node } from "../shared/types";
import { Kbd } from "./Kbd";
import { PaletteItem } from "./PaletteItem";
import { paletteGroups } from "./worktrees";

type Props = {
  open: boolean;
  nodes: Node[];
  now: number;
  onClose: () => void;
  onPick: (node: Node) => void;
};

const DIALOG =
  "fixed inset-0 m-auto h-fit max-h-[min(70vh,34rem)] w-[min(620px,calc(100vw-2rem))] overflow-hidden " +
  "rounded-md border border-rule bg-paper-2 p-0 text-ink backdrop:bg-black/60 " +
  // a phone gets the whole screen; the UA's default dialog margin survives
  // unless it is zeroed explicitly
  "max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0";

export function CommandPalette({ open, nodes, now, onClose, onPick }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const groups = useMemo(() => paletteGroups(nodes, query), [nodes, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery("");
      setActive(0);
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // a new query re-ranks the list; start again from its top
  useEffect(() => setActive(0), [query]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const node = flat[active];
      if (node) onPick(node);
    }
  };

  let index = -1;
  return (
    <dialog
      ref={dialog}
      className={DIALOG}
      aria-label="Jump to a worktree"
      // Esc closes the dialog natively; keep React's open flag in step
      onClose={onClose}
      // a click that lands on the <dialog> itself, not its content, is the backdrop
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col max-sm:h-full">
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <span aria-hidden="true">{"⌕"}</span>
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={"Search worktrees…"}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search worktrees"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[0.875rem] text-ink outline-none placeholder:text-muted"
          />
          <Kbd>esc</Kbd>
        </div>

        <div role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className="m-0 p-4 text-[0.8125rem] text-muted">
              {query.trim()
                ? `No worktree matches “${query.trim()}”.`
                : "Nothing running or resumable right now."}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.title} role="group" aria-label={g.title}>
              <p className="mx-0 mt-2 mb-1 px-4 font-mono text-xs text-muted">{g.title}</p>
              {g.items.map((node) => {
                const i = ++index;
                return (
                  <PaletteItem
                    key={node.path}
                    node={node}
                    now={now}
                    active={i === active}
                    onHover={() => setActive(i)}
                    onPick={() => onPick(node)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-4 border-t border-rule px-4 py-2 font-mono text-xs text-muted">
          <span>
            <Kbd>{"↑"}</Kbd>
            <Kbd>{"↓"}</Kbd> navigate
          </span>
          <span>
            <Kbd>{"↵"}</Kbd> open
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </dialog>
  );
}
