/** The console: every worktree on this machine, its state, and the five
 *  things you can do to it. Owns the state the bars and the index share;
 *  every other module is a pure view, a hook, or a shared primitive.
 *
 *  Comparing against another machine is not here -- it is the /compare page,
 *  linked from the header. The console used to carry its own flat
 *  "local ⇄ machine" tab, and two comparison views with near-identical names
 *  meant the worse one was the one you reached by clicking around. */
import { useCallback, useMemo, useRef, useState } from "react";
import { FilterBar } from "../shared/FilterBar";
import { Lede } from "../shared/Lede";
import { NavLink } from "../shared/NavLink";
import { SearchInput } from "../shared/SearchInput";
import type { Status } from "../shared/StatusLine";
import { StatusLine } from "../shared/StatusLine";
import { TextButton } from "../shared/TextButton";
import { TopBar } from "../shared/TopBar";
import type { Node } from "../shared/types";
import type { FleetEvent } from "./types";
import { useHotkey } from "../shared/useHotkey";
import { useNow } from "../shared/useNow";
import { Wordmark } from "../shared/Wordmark";
import { ActivityStrip } from "./ActivityStrip";
import { AgeList } from "./AgeList";
import { CmdKPill } from "./CmdKPill";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { Index } from "./Index";
import { Legend } from "./Legend";
import { useAct } from "./useAct";
import { useEvents } from "./useEvents";
import { useLive } from "./useLive";
import { useNote } from "./useNote";
import { useTree } from "./useTree";
import type { ViewOpts } from "./ViewOptions";
import { ViewOptions } from "./ViewOptions";
import { byAge, groupByRepo, paletteVerb, stateCounts } from "./worktrees";

function toggled<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export function App() {
  const { nodes, loaded, scannedAt, busy, error, reload } = useTree();
  // useLive needs push() from useEvents and useEvents needs live from useLive;
  // a ref breaks the cycle without a second render
  const pushRef = useRef<(e: FleetEvent) => void>(() => {});
  const { live, bridges } = useLive({
    onEvent: (e) => pushRef.current(e),
    onTree: () => void reload(true),
  });
  const { events, push } = useEvents(live);
  pushRef.current = push;
  const now = useNow();
  const { note, show } = useNote();
  const { run, isBusy } = useAct(show, reload);

  const [opts, setOpts] = useState<ViewOpts>({ cold: false, byAge: false, activity: false });
  const [needle, setNeedle] = useState("");
  const [tails, setTails] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [palette, setPalette] = useState(false);

  const filter = useMemo(() => ({ cold: opts.cold, needle }), [opts.cold, needle]);
  const groups = useMemo(() => groupByRepo(nodes, filter), [nodes, filter]);
  const recent = useMemo(() => byAge(nodes, filter), [nodes, filter]);
  const counts = useMemo(() => (loaded ? stateCounts(nodes) : null), [loaded, nodes]);

  // nothing to search until the first scan lands
  const togglePalette = useCallback(() => setPalette((p) => (loaded ? !p : false)), [loaded]);
  useHotkey("k", togglePalette, { meta: true });

  const pick = useCallback(
    (node: Node) => {
      setPalette(false);
      void run(paletteVerb(node), node);
    },
    [run],
  );

  const toggleTail = useCallback((path: string) => setTails((t) => toggled(t, path)), []);
  const toggleRepo = useCallback((root: string) => setCollapsed((c) => toggled(c, root)), []);

  const status: Status =
    note ?? (error ? { text: error, kind: "error" } : { text: busy ? "scanning…" : "" });

  const trimmed = needle.trim();
  const empty = trimmed
    ? `Nothing matches “${trimmed}”.`
    : "Nothing to show — turn on cold to see idle worktrees.";

  const rowProps = { tails, onToggleTail: toggleTail, empty, now, isBusy, onRun: run };

  return (
    <>
      <TopBar>
        <Wordmark>
          fleet <NavLink href="/compare">compare {"→"}</NavLink>
        </Wordmark>
        <CmdKPill onOpen={togglePalette} />
        <Legend counts={counts} />
        <TextButton onClick={() => void reload(true)} busy={busy}>
          rescan {"→"}
        </TextButton>
      </TopBar>

      <FilterBar>
        <ViewOptions opts={opts} onToggle={(k) => setOpts((o) => ({ ...o, [k]: !o[k] }))} />
        <SearchInput value={needle} onChange={setNeedle} label="Filter worktrees" />
        <StatusLine status={status} />
      </FilterBar>

      {opts.activity && <ActivityStrip events={events} now={now} />}

      <main className="mx-auto max-w-[1200px] px-4 pt-4 pb-12 sm:px-8">
        {!loaded && !error && (
          <Lede>
            Reading the herdr API. Nothing here is hidden {"—"} a closed space keeps its worktree
            and its transcript, so it stays resumable.
          </Lede>
        )}
        {loaded && opts.byAge && <AgeList rows={recent} {...rowProps} />}
        {loaded && !opts.byAge && (
          <Index groups={groups} collapsed={collapsed} onToggleRepo={toggleRepo} {...rowProps} />
        )}
      </main>

      <Footer scannedAt={scannedAt} now={now} live={live} bridges={bridges.length} />

      <CommandPalette
        open={palette}
        nodes={nodes}
        now={now}
        onClose={() => setPalette(false)}
        onPick={pick}
      />
    </>
  );
}
