# herdr-fleet

A control plane for every Claude (and Codex) agent running under
[herdr](https://herdr.dev) across your git worktrees and machines. One server,
four surfaces that all call the same code: a CLI (`fleet`), an MCP server (so
an agent can drive it), a web console + compare page, and a couple of TUIs.

It is the backend for the `/herdr-*` skills that need it
(`herdr-clean-up-sync`, `herdr-dissolve`, `herdr-issue`, `herdr-sleep`,
`herdr-vacation`) in
[nat-build-with-oracle/skills](https://github.com/nat-build-with-oracle/skills).

MIT licensed. Fleet only talks to herdr's local socket API and to `git`/`gh`.

---

## 1. Prerequisites

| Tool | Why | Check |
|---|---|---|
| [herdr](https://herdr.dev) >= 0.9.1 | fleet is a thin layer over herdr's socket API: panes, workspaces, agents | `herdr --version` |
| [bun](https://bun.sh) | runtime for every `.ts`/`.tsx` file here | `bun --version` |
| [gh](https://cli.github.com), authenticated | PRs and issues | `gh auth status` |
| [ghq](https://github.com/x-motemen/ghq) | repo discovery for `fleet audit`/`clean`/`sync` | `ghq root` |
| [Claude Code](https://claude.com/claude-code) | only for the MCP server | `claude --version` |

No `just`, no build system beyond bun.

## 2. Install

```bash
# 1. clone anywhere you like
git clone https://github.com/nat-build-with-oracle/herdr-fleet.git
cd herdr-fleet

# 2. link the checkout and the `fleet` command onto your PATH
mkdir -p ~/.local/share ~/.local/bin
ln -sfn "$PWD" ~/.local/share/herdr-fleet
ln -sfn ~/.local/share/herdr-fleet/fleet.ts ~/.local/bin/fleet

# 3. dependencies
bun install

# 4. (optional) give Claude Code the MCP tools, user scope
claude mcp add -s user fleet -- bun ~/.local/share/herdr-fleet/mcp.ts

# 5. check
fleet help | head -3
```

Make sure `~/.local/bin` is on your `PATH`. The `fleet` command always points
at this checkout, so `git pull` upgrades it.

## 3. The server

Every surface talks to one long-lived process on `127.0.0.1:<port>`
(`4320` by default, set `FLEET_PORT` to change it). It starts itself:

- The CLI starts it on first use if nothing is listening.
- The MCP server starts it on first `tools/call` if nothing is listening.
- Or start it explicitly: `cd ~/.local/share/herdr-fleet && bun server.ts`.

It is token-gated for mutations. The token lives in `.tmp/runtime.json` next
to the source, never on a command line where `ps` could read it. The web
console gets it via a `<meta name="fleet-token">` tag baked into the page at
serve time; the `fleet` CLI reads the same file directly.

Restart it in place (same port, same token, rebuilt) with:

```bash
fleet server-restart
```

Under the hood this is a hand-over: the old process writes `FLEET_HANDOVER=1`
and `FLEET_WAIT_PID`, the new one waits for the old one to exit, then takes
over the port and the runtime file. Nothing that was talking to the old
process gets a connection-refused.

The web console is at `http://127.0.0.1:4320/` and the compare page at
`/compare`. The pages are built with Vite + Tailwind v4 into `web/dist/`; the
server builds them on boot when the sources are newer. By hand: `bun run
web:build`, or `bun run web:dev` for HMR on `:5173`.

## 4. The CLI

```
fleet ls [running|open|resumable|cold] [--repo X] [--machine M] [--json]
fleet restart [target] [--channel|--no-channel]
fleet <open|resume|start|kill|close> [target]
fleet send <target> <text…> [--no-enter] [--dry]
fleet watch <target> [--every] | --list | <target> --stop
fleet inbox
fleet snapshot [--commit] | --auto on|off|status
fleet restore [--month YYYY-MM] [--rev <git rev>] [--go]
fleet report [YYYY-MM]
fleet tail <pane>
fleet events
fleet diff [machine]
fleet server-restart
fleet audit  [--host H] [--json|--tsv] [--min-age N] [--idle-shells] [--repo X] [--skip X]
fleet clean  [--host H] [--tier A,B,C] [--pr] [--idle-shells] [--idle-agents] [--pick wt,...] [--go]
fleet sync   [--host H] [--all] [--go]
```

Run `fleet` with no arguments (or `fleet help`) to print this from the source
itself — the file's own header comment *is* the help text, so it can never
drift out of sync with the code.

### Targets

Every command that takes a `target` accepts:

| form | resolves to |
|---|---|
| *(nothing)* or `self` | the pane you're typing in — from a Claude `!` prompt, that's this very session |
| `/abs/path` or `.` | a worktree path |
| `<pane>` | a herdr pane id (as shown by `herdr pane list`), directly |
| `my-oracle` | a name: exact label first, then a repo's main worktree, then a unique substring. **Ambiguous names list the candidates — fleet never guesses.** |

### `fleet ls` — what's running

```bash
fleet ls                 # everything, sorted like herdr's own sidebar
fleet ls running          # only running agents
fleet ls --repo my-repo --json
```

### `fleet restart` / `open` / `resume` / `start` / `kill` / `close`

```bash
fleet restart                    # restart self — the way to pick up a
                                  # changed .envrc after `maw token use`
fleet restart <pane> --channel   # restart a named pane, turn the fleet
                                  # channel on (accepts the one-time warning
                                  # for you)
fleet kill my-oracle --dry   # see what it WOULD do, touch nothing
```

`restart` is pane-first: it quits the Claude in that pane via Ctrl-C (never
`kill -9`) and resumes the **same session** with the agent's own flags —
deduped, so re-running it doesn't pile up `--channel --channel --channel`.
`kill`/`close` stop another agent's work; never use them to test something —
pass `--dry` instead.

### `fleet send` / `watch` / `inbox` — talking to an agent

```bash
fleet send <pane> "status?"
fleet watch <pane>              # tells you once, when it goes idle/done
fleet inbox                     # replies + watch notes addressed to YOU
```

`send` always targets a **pane id**, never a name — `herdr agent prompt
<name>` prefix-matches names and has misdelivered in practice, so fleet
never calls it. Multi-line text stays one prompt (typed with Shift+Enter,
submitted with Enter).

### `fleet snapshot` / `restore` / `report` — history

See §7 and §8 below.

### `fleet audit` / `clean` / `sync` — worktree hygiene

See §6 below — it's the newest and biggest part of fleet, gets its own
section.

### `--dry` and safety

Every mutating command accepts `--dry` where it makes sense: it prints
*exactly* what would happen — which worktree a target resolves to, which
worktrees would be removed — and does nothing else. Read the plan before you
trust the run.

## 5. MCP — the tools an agent gets

```bash
claude mcp add -s user fleet -- bun ~/.local/share/herdr-fleet/mcp.ts   # step 4 of the install
```

Once added, any Claude Code session has these tools:

`fleet_status`, `fleet_act` (verb + target: open/resume/start/kill/close/restart),
`fleet_tail`, `fleet_events`, `fleet_restart_agent`, `fleet_send`,
`fleet_reply`, `fleet_inbox`, `fleet_watch`, `fleet_snapshot`, `fleet_restore`,
`fleet_report`, `fleet_server_restart`, `fleet_diff`.

The server's `initialize` response carries an **instructions block** written
specifically to head off the one ambiguity that bit us in testing: "restart",
"restart self", and "fleet restart" all mean *restart an agent* (with no
target, that's **you**, the calling agent — you'll quit and resume mid-reply,
which is expected and fine). Only "restart the fleet **server**" means
`fleet_server_restart`, which restarts the web/API process and never touches
any agent.

`fleet audit`/`clean`/`sync` are **not yet MCP tools** — today they're CLI-only
(`worktrees.ts`, invoked directly, not through `/mcp`), because a full audit
walks every repo under your `ghq` root and can take minutes; that's a bad shape for a
synchronous tool call. A read-only `fleet_audit` MCP tool is a reasonable
next step.

## 6. `fleet audit` / `fleet clean` / `fleet sync` — worktree hygiene

This is the part of fleet that answers "I have 175 worktrees, which ones are
safe to remove?" — and does it without ever losing work.

### The five tiers

```
fleet audit
```

sorts every worktree under `ghq` into:

| Tier | Means | `clean` does |
|---|---|---|
| **A** ghost | the worktree's directory is already gone (or it's a herdr space pointed at a missing folder) | `git worktree prune`, or close the orphan space |
| **B** merged | in the default branch, or a merged PR whose head **is** this exact commit | remove |
| **C** stale | pushed, clean, older than `--min-age` (default 3 days) | remove — **the branch stays on GitHub** |
| **D** unsaved | real changes or commits that exist nowhere else | *(only with `--tier D`)* commit to `rescue/<worktree>`, push, optionally open a signed draft PR (`--pr`), **then** remove |
| **K** keep | an agent is working/blocked in it, it was active recently, or it holds gitignored data over the size cap | untouched |

`clean` without `--go` only **prints the plan**. Nothing happens until you
add `--go`. Tiers A/B/C are the default (`--tier A,B,C`); D is opt-in on
purpose, because it commits and pushes on your behalf.

```bash
fleet audit --idle-agents --min-age 0 --json      # everything, including ✓ finished agents
fleet clean --pick wt-one,wt-two --tier D --pr --go   # rescue + PR two named worktrees
fleet sync --all --go                              # fast-forward every checkout that is
                                                     # only BEHIND (never merges/rebases/resets)
```

`--host <ssh-target>` runs the *exact same logic* on another machine:
`worktrees.ts` is self-contained (no imports outside `bun` + node builtins),
so `fleet audit --host my-server` pipes the file itself to `bun run -` over
ssh. The far machine needs `bun`, `git`, `gh`, `ghq` — nothing else from
fleet.

### Every guard here was earned the hard way

This tool exists because of one real incident: a hand-run "commit whatever is
dirty, push, PR" script pushed Codex session logs — including an active OAuth
token — into five PRs, three of them public. It was caught and contained
within minutes, but the lesson went straight into the code:

- `.codex/`, `.env*`, shell snapshots, and credential files are **never**
  committed by a rescue, full stop.
- The staged diff is scanned for key-shaped strings (Anthropic and GitHub token prefixes,
  JWTs, PEM headers, …) and the rescue **stops before pushing anything** if
  it matches.
- Repo git hooks never run (`-c core.hooksPath=/dev/null`) — one repo's
  post-commit hook rebuilds and overwrites a binary on `PATH`.
- `-c core.quotepath=off` — git escapes non-ASCII paths by default, which
  silently breaks `git add` on vault directories named in Thai/Unicode, and a
  subsequent `worktree remove --force` then deletes the file it never staged.
- A single file over 10 MB, or a rescue totalling over 50 MB, is refused
  outright — a lab full of embedding data is not a rescue commit.
- A worktree holding more than 50 MB of **gitignored** data that isn't
  obviously rebuildable (`node_modules`/`.venv`/`target`/`.build`/… are —
  a database, a model cache, aren't) is marked **K, kept** — `git worktree
  remove --force` deletes ignored files too, and nothing else ever checks
  for them.
- Every row is **re-checked immediately before acting on it** — a plan that
  was true ten seconds ago might not be true now.

## 7. Snapshots — a diffable, queryable fleet history

```bash
fleet snapshot --commit          # one-shot: write + commit if anything changed
fleet snapshot --auto on         # commit automatically on every herdr structural
                                  # event (agent/pane/workspace created or closed),
                                  # after a 15s settle window
fleet snapshot --auto status     # check whether auto-snapshot is on
fleet restore --month 2026-09 --go
```

Writes to `$FLEET_SNAPSHOT_DIR/YYYY-MM/` (see §9 for the default):

- `fleet.tsv` / `resumable.tsv` — one row per agent: pane, workspace, name,
  runtime, model, repo, worktree, branch, head, session id, channel on/off,
  token name, cwd, transcript path, argv (as JSON).
- `fleet.md` — the same data rendered as markdown, one `<details>` block per
  agent, easy to skim in a PR diff.

Volatile fields (uptime, timestamps that change every run) are excluded from
the diff on purpose — `takeSnapshot` compares against the last commit and
**writes nothing if nothing real changed**, so the history is a record of
actual fleet state changes, not a timer. Query it with plain SQL:

```bash
duckdb -c "select count(*) from read_csv('$FLEET_SNAPSHOT_DIR/2026-09/fleet.tsv', delim='\t')"
```

## 8. The monthly report

```bash
fleet report 2026-09
```

Drafts (never posts — that's a separate, explicit `gh` call) a report built
**only from records**: the month's snapshot history plus PRs merged that
month, read fresh from `gh pr list`. It opens with the layout exactly as
herdr's own sidebar draws it (open spaces, sidebar order, the same state
marks `◐ ○ ✓ ×`), then month-close stats, movement since the first snapshot,
merged PRs, a changelog, and one `<details open>` block per agent with the
same level of detail as `/herdr-pr`.

## 9. Configuration

| Variable | Default | What |
|---|---|---|
| `FLEET_PORT` | `4320` | server port |
| `FLEET_HOST` | `127.0.0.1` | server bind address |
| `FLEET_SNAPSHOT_DIR` | `../../ψ/memory/fleet` relative to the source | where `fleet snapshot` / `report` write. **Set this** when running from a standalone clone, to a directory inside a git repo you want the history in |
| `FLEET_HERDR_SOCKET` | herdr's own default | herdr socket to talk to |
| `FLEET_TOKEN_VAR` | `CLAUDE_TOKEN_NAME` | name of the `.envrc` variable that labels which account an agent runs under (shown in snapshots) |

The monthly report derives the host name from `hostname` and the repo slug
from `git remote get-url origin`; nothing org-specific is baked in.

## 10. Known issues

Found while using fleet; not fixed yet.

- **Duplicate snapshots**: `fleet snapshot` can record the same state twice.
- **`channel-on` shows 0**: the channel-on figure can read 0 even when an agent
  was started with the fleet channel.
- **`fleet resume --channel`** does not behave like `fleet restart --channel`.
- `fleet audit`/`clean`/`sync` are CLI-only, not MCP tools (a full audit can
  take minutes).

## 11. License

MIT, see [LICENSE](LICENSE).
