/** The compare page: pick a machine, compare it against this one, read the
 *  result as a tree or a graph. Owns the state the bars and views share;
 *  every other module is a pure view, a hook, or a shared primitive. */
import { useCallback, useMemo, useState } from "react";
import { FilterBar } from "../shared/FilterBar";
import { Lede } from "../shared/Lede";
import { NavLink } from "../shared/NavLink";
import { SearchInput } from "../shared/SearchInput";
import { StatusLine } from "../shared/StatusLine";
import { TextButton } from "../shared/TextButton";
import { TopBar } from "../shared/TopBar";
import { useNow } from "../shared/useNow";
import { Wordmark } from "../shared/Wordmark";
import { Footnote } from "./Footnote";
import { GraphView } from "./GraphView";
import { MachinePicker } from "./MachinePicker";
import { ScopeFilter } from "./ScopeFilter";
import { Tally } from "./Tally";
import { TreeList } from "./TreeList";
import { VerdictFilter } from "./VerdictFilter";
import { ViewToggle } from "./ViewToggle";
import { filterRows, groupByRepo } from "./groupRows";
import { filterScope, scopeCounts } from "./scope";
import type { Scope } from "./scope";
import { useCompare } from "./useCompare";
import { useMachines } from "./useMachines";
import type { Verdict, View } from "./types";

const DEFAULT_SHOWN: Verdict[] = ["differs", "only-left", "only-right", "unknowable"];

export function App() {
  const { machines, index, setIndex, step, error: machineError, current } = useMachines();
  const { data, busy, error, reload } = useCompare(current?.id);
  const now = useNow();

  const [shown, setShown] = useState<Set<Verdict>>(() => new Set(DEFAULT_SHOWN));
  const [view, setView] = useState<View>("list");
  const [needle, setNeedle] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // "all" by default: a filter that hides rows the moment you open the page
  // would make the tallies in the bar disagree with what is on screen
  const [scope, setScope] = useState<Scope>("all");

  const rows = useMemo(
    () => (data ? filterRows(filterScope(data.rows, scope, now), shown, needle) : []),
    [data, shown, needle, scope, now],
  );
  const counts = useMemo(() => (data ? scopeCounts(data.rows, now) : null), [data, now]);

  const toggleIn = <T,>(set: (fn: (prev: Set<T>) => Set<T>) => void) => (v: T) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  const toggleVerdict = useCallback(toggleIn<Verdict>(setShown), []);
  const toggleRepo = useCallback(toggleIn<string>(setCollapsed), []);

  const allCollapsed = rows.length > 0 && groupByRepo(rows).every((g) => collapsed.has(g.repo));
  const foldAll = useCallback(() => {
    setCollapsed(allCollapsed ? new Set() : new Set(groupByRepo(rows).map((g) => g.repo)));
  }, [allCollapsed, rows]);

  const failure = machineError ?? error;
  const rightName = current?.target ?? data?.machine ?? "";

  return (
    <>
      <TopBar>
        <Wordmark>
          fleet {"·"} compare <NavLink href="/">{"←"} console</NavLink>
        </Wordmark>
        <Tally counts={data?.counts} />
        <TextButton onClick={reload} busy={busy}>
          rescan {"→"}
        </TextButton>
      </TopBar>

      <FilterBar>
        <MachinePicker machines={machines} index={index} onPick={setIndex} onStep={step} />
        <ScopeFilter scope={scope} counts={counts} onChange={setScope} />
        <VerdictFilter shown={shown} onToggle={toggleVerdict} />
        <ViewToggle view={view} onChange={setView} />
        {view === "list" && (
          <TextButton onClick={foldAll}>{allCollapsed ? "expand all" : "collapse all"}</TextButton>
        )}
        <SearchInput value={needle} onChange={setNeedle} label="Filter rows" />
        <StatusLine
          status={failure ? { text: failure, kind: "error" } : { text: busy ? "comparing…" : "" }}
        />
      </FilterBar>

      <main className="mx-auto max-w-[1240px] px-4 pt-4 pb-8 sm:px-8">
        {!current && <Lede>No saved machine to compare against.</Lede>}
        {current && !data && !failure && <Lede>Reading {current.target}{"…"}</Lede>}
        {current && data && rows.length === 0 && <Lede>Nothing matches the current filters.</Lede>}
        {data && rows.length > 0 && view === "list" && (
          <TreeList rows={rows} machine={rightName} collapsed={collapsed} onToggleRepo={toggleRepo} now={now} />
        )}
        {data && rows.length > 0 && view === "graph" && <GraphView rows={rows} machine={rightName} />}
        {data && rows.length > 0 && <Footnote />}
      </main>
    </>
  );
}
