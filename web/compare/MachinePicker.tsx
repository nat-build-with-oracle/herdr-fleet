/** Pick the right-hand machine by clicking it, not by opening a menu.
 *
 *  A chip per saved machine, with a step control on each side. The label alone
 *  is ambiguous (two profiles are both "white"), so every chip carries its
 *  target next to the label -- that is the part that is actually unique.
 *  Left/Right arrow keys step too, as long as you are not typing. */
import { useCallback } from "react";
import { SegButton } from "../shared/SegButton";
import { SegGroup } from "../shared/SegGroup";
import { useHotkey } from "../shared/useHotkey";
import type { Machine } from "./types";

type Props = {
  machines: Machine[];
  index: number;
  onPick: (index: number) => void;
  onStep: (delta: number) => void;
};

export function MachinePicker({ machines, index, onPick, onStep }: Props) {
  const back = useCallback(() => onStep(-1), [onStep]);
  const next = useCallback(() => onStep(1), [onStep]);
  useHotkey("ArrowLeft", back, { enabled: machines.length > 1 });
  useHotkey("ArrowRight", next, { enabled: machines.length > 1 });

  if (!machines.length) return <span className="text-xs text-muted">no saved machines</span>;

  return (
    <SegGroup label="Machine to compare against">
      <SegButton pressed={false} onClick={back} ariaLabel="Previous machine" title="Left arrow" className="px-1">
        {"◀"}
      </SegButton>
      {machines.map((m, i) => (
        <SegButton
          key={m.id}
          pressed={i === index}
          onClick={() => onPick(i)}
          title={m.target}
          className="inline-flex items-baseline gap-1"
        >
          <span>{m.label}</span>
          {/* the target is the unique part, so it is on the chip itself */}
          <span className={i === index ? "text-muted" : "text-rule"}>{m.target}</span>
        </SegButton>
      ))}
      <SegButton pressed={false} onClick={next} ariaLabel="Next machine" title="Right arrow" className="px-1">
        {"▶"}
      </SegButton>
    </SegGroup>
  );
}
