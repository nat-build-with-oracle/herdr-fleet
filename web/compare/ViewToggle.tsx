/** list = the tree. graph = the same pairs with edges drawn between them. */
import { SegButton } from "../shared/SegButton";
import { SegGroup } from "../shared/SegGroup";
import type { View } from "./types";

type Props = { view: View; onChange: (v: View) => void };

export function ViewToggle({ view, onChange }: Props) {
  return (
    <SegGroup label="View">
      {(["list", "graph"] as View[]).map((v) => (
        <SegButton key={v} pressed={view === v} onClick={() => onChange(v)}>
          {v}
        </SegButton>
      ))}
    </SegGroup>
  );
}
