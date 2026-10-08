#!/usr/bin/env bun
/**
 * Worktree audit + clean for one machine. Self-contained on purpose (only bun and
 * node builtins): `fleet audit --host my-server` pipes this very file over ssh to
 * `bun run -`, so it must run on a machine that has none of fleet installed.
 *
 *   bun worktrees.ts audit [--json|--tsv] [--min-age 3] [--idle-shells] [--no-fetch] [--repo X] [--skip X]
 *   bun worktrees.ts clean [--tier A,B,C] [--pr] [--min-age 3] [--idle-shells] [--idle-agents]
 *                          [--pick p1,p2] [--repo X] [--skip X] [--go]
 *
 *   --idle-shells  a bare shell pane no longer keeps its worktree (its space is closed)
 *   --idle-agents  nor does an agent that is idle or done (✓ in the sidebar): it is quit
 *                  with ctrl-c first; its transcript stays in ~/.claude/projects.
 *                  A working or blocked agent always keeps its worktree.
 *   --pick         only these worktrees (paths or names), chosen by a human, so the
 *                  --min-age rule does not apply to them; idle agents/shells in them
 *                  are closed. Tiers still decide what is safe: dirty work is D.
 *
 *   bun worktrees.ts sync [--all] [--go]
 *
 *   sync fast-forwards checkouts that are only BEHIND their upstream (the sidebar's
 *   `main ↓130`): the checkouts herdr has a pane in, or every ghq repo with --all.
 *   Only when nothing is modified, nothing is ahead, and no agent is working there;
 *   anything else is reported, never merged or reset. Plan unless --go.
 *
 *   --repo / --skip take comma-separated substrings of the repo path (org/name), e.g.
 *   --skip arra-oracle-v4,odoo-yd to leave another owner's worktrees alone.
 *
 * Removing a worktree deletes its directory; its branch and commits stay. So the only
 * things a clean can lose are uncommitted files and commits that exist nowhere else --
 * and every tier below is defined so that it loses neither:
 *
 *   A  ghost      directory already gone               git worktree prune
 *   B  merged     in the default branch (or a merged PR   remove
 *                 whose head IS this HEAD), clean
 *   C  stale      pushed, clean, older than --min-age    remove (the branch stays)
 *   D  unsaved    real changes or local-only commits,    commit to rescue/<wt>, push,
 *                 older than --min-age                   [--pr draft PR], then remove
 *   K  keep       an agent pane is in it, or younger than --min-age
 *
 * D never commits .codex/, .env*, shell snapshots or credentials, stops if the staged
 * diff looks like it holds a key, keeps files over 10 MB on disk, and refuses a
 * rescue over 50 MB in total. Repo hooks never run (core.hooksPath=/dev/null).
 *
 * A worktree also stays when it holds over 50 MB of gitignored data that is not
 * rebuildable (node_modules, .venv, target, dist … are): `worktree remove --force`
 * deletes ignored files too, and no status or rescue ever sees them.
 *
 * "Clean" ignores junk: macOS ._* AppleDouble files, .DS_Store, .envrc. Every row is
 * re-checked right before it is acted on. `clean` without --go only prints the plan.
 * D is never in the default tiers; ask for it with --tier D.
 */
import { $ } from "bun";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";

export type Tier = "A" | "B" | "C" | "D" | "K";
export type Row = {
  tier: Tier; why: string; repo: string; worktree: string; branch: string; path: string; root: string;
  slug: string; def: string; merged: string; pr: string; dirty: number; junk: number; localOnly: number;
  panes: string; agents: string; busy: string; locked: boolean; last: number; age: number;
};
export type Opts = { minAge?: number; idleShells?: boolean; idleAgents?: boolean; pick?: string[] };
const IDLE = new Set(["idle", "done"]);
const picked = (r: { path: string; worktree: string }, o: Opts) => !!o.pick?.some((x) => x === r.path || x === r.worktree);

const HOME = process.env.HOME!;
/** never committed by a rescue: tool homes, secrets, OS junk */
const NEVER = [/(^|\/)\.codex\//, /shell_snapshots/, /(^|\/)\.envrc$/, /(^|\/)\.env$/, /(^|\/)\.env\.(local|dev|development|prod|production)$/,
  /(^|\/)\.claude\/\.credentials/, /(^|\/)\._/, /(^|\/)\.DS_Store$/];
const JUNK = [/(^|\/)\._[^/]*$/, /(^|\/)\.DS_Store$/, /(^|\/)\.envrc$/];
/** a staged diff with any of these stops the rescue before anything is pushed */
const SECRET = /sk-an[t]-[A-Za-z0-9_-]{20,}|sk-pro[j]-[A-Za-z0-9_-]{20,}|gh[p]_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pa[t]_[A-Za-z0-9_]{30,}|xox[bp]-[A-Za-z0-9-]{20,}|AKI[A][0-9A-Z]{16}|eyJhbGc[i][A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KE[Y]/;
/** gitignored but rebuildable: deleting these with a worktree loses nothing */
const REBUILDABLE = /(^|\/)(node_modules|\.venv|venv|__pycache__|target|dist|build|\.build[^/]*|DerivedData|\.next|\.turbo|\.cache|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.omx)(\/|$)/;
const IGNORED_CAP = 50 << 20; // more gitignored data than this keeps the worktree
const BIG = 10 << 20;       // one file over this stays on disk (worktree kept)
const TOTAL = 50 << 20;    // a rescue commit over this is refused outright

const sh = (cmd: string) => $`bash -lc ${cmd}`.nothrow().quiet().text().then((t) => t.trim());
// no repo hooks ever (maw-js deploys on commit), and non-ASCII paths (ψ/) unescaped
const git = (dir: string, args: string[]) =>
  $`git -c core.quotepath=off -c core.hooksPath=/dev/null -C ${dir} ${args}`.nothrow().quiet();
const gitText = (dir: string, args: string[]) => git(dir, args).text().then((t) => t.trim());
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** porcelain paths (renames resolved), with or without junk */
async function changes(p: string): Promise<string[]> {
  // no trim(): porcelain's first column is often a space (" M path"), and trimming the
  // whole output shifts the first line so slice(3) eats a character of its path
  const out = (await git(p, ["status", "--porcelain", "-uall"]).text()).replace(/\n+$/, "");
  return out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"(.*)"$/, "$1").replace(/.* -> /, ""));
}

/** gitignored files that are NOT rebuildable (a lab's .data/, a model cache): `worktree
 *  remove --force` deletes them too, and no status/rescue ever sees them */
async function ignoredData(p: string): Promise<{ bytes: number; top: string }> {
  const out = await gitText(p, ["status", "--porcelain", "--ignored"]);
  let bytes = 0, top = "", topB = 0;
  for (const l of out.split("\n")) {
    if (!l.startsWith("!! ")) continue;
    const f = l.slice(3).replace(/^"(.*)"$/, "$1");
    if (REBUILDABLE.test(f) || JUNK.some((r) => r.test(f))) continue;
    const kb = +(await $`du -sk ${`${p}/${f}`}`.nothrow().quiet().text()).split("\t")[0] || 0;
    bytes += kb * 1024;
    if (kb * 1024 > topB) { topB = kb * 1024; top = f; }
  }
  return { bytes, top };
}
const mb = (b: number) => b > 1 << 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.round(b / 2 ** 20)} MB`;

type Pane = { id: string; ws: string; cwd: string; agent: string; status: string };
async function panes(): Promise<Pane[]> {
  try {
    const j = JSON.parse(await sh("herdr pane list 2>/dev/null"));
    return j.result.panes.map((p: any) => ({ id: p.pane_id, ws: p.workspace_id, cwd: real(p.foreground_cwd || p.cwd), agent: p.agent ?? "", status: p.agent_status ?? "" }));
  } catch { return []; }
}

/** newest transcript mtime per encoded project dir, over every ~/.claude/projects* root */
function transcripts(): Map<string, number> {
  const m = new Map<string, number>();
  let roots: string[] = [];
  try { roots = readdirSync(`${HOME}/.claude`).filter((d) => d.startsWith("projects")); } catch {}
  for (const root of roots) for (const enc of readdirSync(`${HOME}/.claude/${root}`)) {
    let t = 0;
    try { for (const f of readdirSync(`${HOME}/.claude/${root}/${enc}`)) if (f.endsWith(".jsonl")) t = Math.max(t, statSync(`${HOME}/.claude/${root}/${enc}/${f}`).mtimeMs / 1000); } catch {}
    if (t) m.set(enc, Math.max(m.get(enc) ?? 0, t));
  }
  return m;
}
const encode = (p: string) => p.replace(/^\//, "-").replace(/[/.]/g, "-");

export async function audit(o: Opts & { fetch?: boolean; only?: string[]; skip?: string[]; log?: (s: string) => void } = {}): Promise<Row[]> {
  const minAge = o.minAge ?? 3, log = o.log ?? (() => {});
  const repos = (await sh("ghq list -p")).split("\n").filter(Boolean)
    .filter((r) => (!o.only?.length || o.only.some((x) => r.includes(x))) && !o.skip?.some((x) => r.includes(x)));
  const [ps, tx] = [await panes(), transcripts()];
  const rows: Row[] = [], seen = new Set<string>();
  let i = 0;
  for (const repoPath of repos) {
    i++;
    const por = await gitText(repoPath, ["worktree", "list", "--porcelain"]);
    const blocks = por.split("\n\n").slice(1).filter((b) => b.startsWith("worktree "));
    if (!blocks.length) continue;
    const root = real(repoPath);
    log(`[${i}/${repos.length}] ${basename(root)} ${blocks.length}`);
    if (o.fetch !== false) await git(root, ["fetch", "--prune", "--quiet"]);
    const def = (await gitText(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main";
    const slug = (await gitText(root, ["remote", "get-url", "origin"])).replace(/.*github\.com[:/]/, "").replace(/\.git$/, "");
    let prs: any[] = [];
    if (slug) try { prs = JSON.parse(await $`gh pr list -R ${slug} --state all --limit 300 --json number,state,headRefName,headRefOid`.quiet().text()); } catch {}
    for (const b of blocks) {
      const raw = b.match(/^worktree (.*)$/m)![1], path = real(raw);
      if (seen.has(path)) continue; // nested checkouts list the same worktree twice
      seen.add(path);
      const branch = b.match(/^branch refs\/heads\/(.*)$/m)?.[1] ?? "-";
      const base: Omit<Row, "tier" | "why"> = { repo: basename(root), worktree: basename(path), branch, path, root, slug, def,
        merged: "-", pr: "-", dirty: 0, junk: 0, localOnly: 0, panes: "", agents: "", busy: "", locked: /^locked/m.test(b), last: 0, age: 99999 };
      if (!existsSync(path)) { rows.push({ ...base, tier: "A", why: "directory gone" }); continue; }
      const ch = await changes(path);
      const junk = ch.filter((f) => JUNK.some((r) => r.test(f))).length;
      const localOnly = +(await gitText(path, ["rev-list", "--count", "HEAD", "--not", "--remotes"])) || 0;
      const head = await gitText(path, ["rev-parse", "HEAD"]);
      const ancestor = (await git(path, ["merge-base", "--is-ancestor", "HEAD", def])).exitCode === 0;
      const pr = prs.filter((x) => x.headRefName === branch).sort((a, b) => b.number - a.number)[0];
      const prMerged = pr?.state === "MERGED" && pr.headRefOid === head;
      const last = Math.max(+(await gitText(path, ["log", "-1", "--format=%ct"])) || 0,
        +(await gitText(path, ["reflog", "-1", "--format=%ct", "HEAD"])) || 0, tx.get(encode(path)) ?? 0, tx.get(encode(raw)) ?? 0);
      const inside = ps.filter((p) => p.cwd === path || p.cwd.startsWith(path + "/"));
      const r = { ...base, merged: prMerged ? `#${pr.number}` : ancestor ? "ancestor" : "no", pr: pr ? `#${pr.number}:${pr.state}` : "-",
        dirty: ch.length - junk, junk, localOnly, panes: inside.map((p) => p.id).join(","), agents: inside.filter((p) => p.agent).map((p) => `${p.id}:${p.agent}:${p.status}`).join(","),
        busy: inside.filter((p) => p.agent && !IDLE.has(p.status)).map((p) => `${p.id}:${p.status}`).join(","),
        last, age: Math.floor((Date.now() / 1000 - last) / 86400) };
      const c = classify(r, { ...o, minAge });
      if (c.tier !== "K") {
        const ig = await ignoredData(path);
        if (ig.bytes > IGNORED_CAP) { c.tier = "K"; c.why = `holds ${mb(ig.bytes)} gitignored data (${ig.top}); move it first`; }
      }
      rows.push({ ...r, ...c });
    }
  }
  // the other half of "sync": herdr spaces whose every pane sits in a directory that no
  // longer exists (a worktree removed behind herdr's back). Tier A; clean closes them.
  if (!o.only?.length && !o.skip?.length) {
    for (const ws of new Set(ps.map((p) => p.ws))) {
      const inWs = ps.filter((p) => p.ws === ws);
      if (inWs.every((p) => p.cwd && !existsSync(p.cwd)) && !inWs.some((p) => p.agent))
        rows.push({ tier: "A", why: "herdr space on a missing directory", repo: "herdr", worktree: ws, branch: "-", path: inWs[0].cwd, root: "",
          slug: "", def: "", merged: "-", pr: "-", dirty: 0, junk: 0, localOnly: 0, panes: inWs.map((p) => p.id).join(","), agents: "", busy: "", locked: false, last: 0, age: 99999 });
    }
  }
  return rows;
}

function classify(r: Omit<Row, "tier" | "why">, o: Opts): { tier: Tier; why: string } {
  const pick = picked(r, o), minAge = pick ? 0 : o.minAge ?? 3;
  if (o.pick?.length && !pick) return { tier: "K", why: "not picked" };
  if (r.busy) return { tier: "K", why: `agent working ${r.busy}` };
  if (r.agents && !(o.idleAgents || pick)) return { tier: "K", why: `agent ${r.agents} (--idle-agents to include)` };
  if (r.panes && !r.agents && !(o.idleShells || pick)) return { tier: "K", why: `pane ${r.panes} (shell; --idle-shells to include)` };
  const clean = r.dirty === 0, pushed = r.localOnly === 0 || r.merged.startsWith("#");
  // a merged PR whose head is this HEAD is safe at any age; "ancestor" is also what a
  // brand-new branch looks like, so that one still has to be older than --min-age
  if (clean && r.merged.startsWith("#")) return { tier: "B", why: `PR ${r.merged} merged` };
  if (r.age < minAge) return { tier: "K", why: `active ${r.age}d ago` };
  if (clean && r.merged === "ancestor") return { tier: "B", why: "in default branch" };
  if (clean && pushed) return { tier: "C", why: `pushed, idle ${r.age}d` };
  return { tier: "D", why: [r.dirty && `${r.dirty} changed`, r.localOnly && `${r.localOnly} local-only commits`].filter(Boolean).join(", ") };
}

/* ---------------------------------------------------------------- clean */

export type Done = { tier: Tier; path: string; result: string; url?: string };
type Signer = { host: string; pane?: string; session?: string; transcript?: string; model?: string; who?: string };

export async function clean(rows: Row[], o: Opts & { tiers: Tier[]; go: boolean; pr?: boolean; signer?: Signer; log?: (s: string) => void }): Promise<Done[]> {
  const out: Done[] = [], log = o.log ?? (() => {});
  const want = rows.filter((r) => o.tiers.includes(r.tier) && r.tier !== "K");
  if (!o.go) return want.map((r) => ({ tier: r.tier, path: r.path, result: `would ${verb(r, o.pr)}` }));
  // A: close orphan herdr spaces, then prune once per repo
  for (const r of want.filter((r) => r.tier === "A" && !r.root)) {
    const ok = await sh(`herdr workspace close ${r.worktree} >/dev/null 2>&1 && echo ok`);
    out.push({ tier: "A", path: `${r.worktree} ${r.path}`, result: ok ? "CLOSED space" : "FAIL close space" });
  }
  for (const root of new Set(want.filter((r) => r.tier === "A" && r.root).map((r) => r.root))) {
    const n = (await gitText(root, ["worktree", "prune", "-v"])).split("\n").filter((l) => l.includes("Removing")).length;
    out.push({ tier: "A", path: root, result: `pruned ${n}` });
  }
  const ps = await panes();
  for (const r of want.filter((r) => r.tier !== "A")) {
    const res = await one(r, ps, o).catch((e) => ({ tier: r.tier, path: r.path, result: `FAIL ${e.message}` }));
    log(`${res.result.padEnd(8).slice(0, 8)} ${r.tier} ${r.path}`);
    out.push(res);
  }
  return out;
}

const verb = (r: Row, pr?: boolean) =>
  (r.tier === "A" ? (r.root ? "prune" : `close herdr space ${r.worktree}`) : r.tier === "D" ? `commit+push rescue/${r.worktree}${pr ? " + draft PR" : ""}, then remove` : "remove") +
  (r.agents ? ` (quit ${r.agents.split(",").map((a) => a.split(":").slice(0, 2).join(":")).join(" ")})` : "") + (r.panes && r.tier !== "A" ? ` (close space of ${r.panes})` : "");

async function one(r: Row, ps: Pane[], o: Opts & { pr?: boolean; signer?: Signer }): Promise<Done> {
  const done = (result: string, url?: string): Done => ({ tier: r.tier, path: r.path, result, url });
  if (!existsSync(r.path)) return done("GONE");
  // re-check: nothing may have changed since the audit
  const inside = ps.filter((p) => p.cwd === r.path || p.cwd.startsWith(r.path + "/"));
  const pick = picked(r, o);
  if (inside.some((p) => p.agent && !IDLE.has(p.status))) return done("SKIP agent working");
  if (inside.some((p) => p.agent) && !(o.idleAgents || pick)) return done("SKIP agent");
  if (inside.some((p) => !p.agent) && !(o.idleShells || o.idleAgents || pick)) return done("SKIP pane");
  let url: string | undefined;
  if (r.tier === "D") {
    const saved = await rescue(r, o);
    if (!saved.ok) return done(saved.result);
    url = saved.url;
    if (saved.keep) return done(`KEPT ${saved.result}`, url);
  }
  const ig = await ignoredData(r.path);
  if (ig.bytes > IGNORED_CAP) return done(`SKIP ${mb(ig.bytes)} gitignored data (${ig.top})`, url);
  // only junk may be deleted with the worktree; a .codex home or .env that a rescue
  // refused to commit keeps the worktree, so a human decides what happens to it
  const left = (await changes(r.path)).filter((f) => !JUNK.some((x) => x.test(f)));
  if (left.length) return done(`SKIP uncommitted: ${left.slice(0, 3).join(" ")}${left.length > 3 ? ` +${left.length - 3}` : ""}`, url);
  const lo = +(await gitText(r.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"])) || 0;
  if (lo && !r.merged.startsWith("#")) return done(`SKIP ${lo} local-only`, url);
  // quit idle agents gently (ctrl-c until herdr no longer sees one); the transcript stays
  for (const p of inside.filter((p) => p.agent)) if (!(await quit(p.id))) return done(`SKIP ${p.id} did not quit`, url);
  for (const ws of new Set(inside.map((p) => p.ws))) {
    // close the space only if every pane in it is inside this worktree -- through
    // herdr's own worktree remove when it can, so the sidebar and herdr agree
    if (ps.filter((p) => p.ws === ws).every((p) => p.cwd === r.path || p.cwd.startsWith(r.path + "/")))
      if (!(await sh(`herdr worktree remove --workspace ${ws} --force >/dev/null 2>&1 && echo ok`))) await sh(`herdr workspace close ${ws}`);
  }
  if (!existsSync(r.path)) { await git(r.root, ["worktree", "prune"]); return done("RM", url); }
  await git(r.root, ["worktree", "unlock", r.path]);
  const rm = await git(r.root, ["worktree", "remove", "--force", r.path]);
  return done(rm.exitCode === 0 ? "RM" : `FAIL ${rm.stderr.toString().trim().split("\n")[0]}`, url);
}

async function quit(pane: string): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const a = await sh(`herdr pane get ${pane} 2>/dev/null | jq -r '.result.pane.agent // empty'`);
    if (!a) return true;
    await sh(`herdr pane send-keys ${pane} ctrl+c`);
    await Bun.sleep(700);
  }
  return false;
}

async function rescue(r: Row, o: { pr?: boolean; signer?: Signer }): Promise<{ ok: boolean; keep?: boolean; result: string; url?: string }> {
  const p = r.path;
  if (!r.slug) return { ok: false, result: "SKIP no github origin" };
  const cur = await gitText(p, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const before = await gitText(p, ["log", "-1", "--format=%h %s"]);
  const https = `https://github.com/${r.slug}.git`;
  let b = cur.startsWith("rescue/") ? cur : `rescue/${r.worktree}`;
  if (b !== cur) {
    if ((await git(p, ["rev-parse", "-q", "--verify", `refs/heads/${b}`])).exitCode === 0) b += `-${(await sh("hostname -s")) || "host"}`;
    if ((await git(p, ["switch", "-q", "-c", b])).exitCode) return { ok: false, result: "FAIL switch" };
  }
  const remote = (await gitText(p, ["ls-remote", "--heads", https, b])).split("\t")[0];
  if (remote && remote !== (await gitText(p, ["rev-parse", "HEAD"]))) {
    const nb = `${b}-${(await sh("hostname -s")) || "host"}`;
    await git(p, ["branch", "-m", b, nb]); b = nb;
  }
  const held: string[] = [], add: string[] = [];
  let total = 0;
  for (const f of await changes(p)) {
    if (NEVER.some((x) => x.test(f))) continue;
    const full = `${p}/${f}`;
    const size = existsSync(full) && statSync(full).isFile() ? statSync(full).size : 0;
    if (size > BIG) { held.push(f); continue; }
    total += size; add.push(f);
  }
  // a lab full of data (my-lab: 3.7 GB in files under 10 MB each) is not a rescue
  // commit; stop before anything is staged and leave the worktree for a human
  if (total > TOTAL) return { ok: false, result: `STOP ${Math.round(total / 2 ** 20)} MB to commit (cap ${TOTAL / 2 ** 20} MB); nothing pushed` };
  for (const f of add) await git(p, ["add", "-A", "--", f]);
  const staged = await git(p, ["diff", "--cached"]).text();
  if (SECRET.test(staged)) { await git(p, ["reset", "-q"]); return { ok: false, result: "STOP secret-like string in the diff; nothing pushed" }; }
  if (staged) {
    const c = await git(p, ["commit", "-q", "-m", `chore(rescue): save uncommitted work from ${r.worktree} before worktree removal\n\nFound during a worktree cleanup on ${o.signer?.host ?? "this machine"}; last touched ${new Date(r.last * 1000).toISOString().slice(0, 16)} (${r.age} days).\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`]);
    if (c.exitCode) return { ok: false, result: `FAIL commit ${c.stderr.toString().trim().split("\n")[0]}` };
  }
  if ((await git(p, ["push", "-q", https, `HEAD:refs/heads/${b}`])).exitCode) return { ok: false, result: "FAIL push" };
  // pushing to a URL leaves origin/* untouched; record what the remote now holds, or the
  // local-only check before removal still counts the commit that was just pushed
  await git(p, ["update-ref", `refs/remotes/origin/${b}`, "HEAD"]);
  let url: string | undefined;
  if (o.pr) {
    const body = prBody(r, b, before, held, await gitText(p, ["diff", "--stat", `${r.def}...HEAD`]), o.signer);
    const pr = await $`gh pr create -R ${r.slug} --draft --base ${r.def.replace(/^origin\//, "")} --head ${b} --title ${`rescue: uncommitted work from ${r.worktree} (${o.signer?.host ?? "local"}, ${r.age}d old)`} --body ${body}`.nothrow().quiet();
    url = pr.stdout.toString().trim().split("\n").pop();
    if (!url?.startsWith("https://")) return { ok: true, keep: true, result: `pushed ${b}, PR failed: ${pr.stderr.toString().trim().split("\n").pop()}` };
  }
  return held.length ? { ok: true, keep: true, result: `held >10MB: ${held.join(" ")}`, url } : { ok: true, result: `saved ${b}`, url };
}

function prBody(r: Row, b: string, before: string, held: string[], stat: string, s?: Signer): string {
  const origin = transcriptOf(r.path);
  return `Work found in a worktree during a worktree cleanup, saved here so the worktree can be removed without losing it. **Draft on purpose**: close it if the work is obsolete; the branch keeps it either way.

| | |
|---|---|
| worktree | \`${s?.host ?? "local"}:${r.path}\` |
| original branch | \`${r.branch}\` at \`${before}\` |
| last activity | ${new Date(r.last * 1000).toISOString().slice(0, 16).replace("T", " ")} (**${r.age} days ago**) |
| found | ${r.why} |
${held.length ? `| **held back (>10 MB, still on disk, worktree kept)** | ${held.map((h) => `\`${h}\``).join(" ")} |\n` : ""}
<details><summary>Diff against ${r.def}</summary>

\`\`\`
${stat.split("\n").slice(-25).join("\n")}
\`\`\`
</details>

---

**Built by**

\`\`\`yaml
agent:
  who: ${s?.who ?? "fleet clean"}
  model: ${s?.model ?? "-"}
  role: rescuer (did not write this code)
origin:
  machine: ${s?.host ?? "local"}
  worktree: ${r.path}
  branch: ${r.branch}
  head: ${before}
  session: ${origin ?? "none found on this machine"}
rescuer:
  pane: ${s?.pane ?? "-"}
  session: ${s?.session ?? "-"}
  transcript: ${s?.transcript ?? "-"}
\`\`\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
}

function transcriptOf(p: string): string | undefined {
  let best: [number, string] | undefined;
  for (const root of readdirSync(`${HOME}/.claude`).filter((d) => d.startsWith("projects"))) {
    const dir = `${HOME}/.claude/${root}/${encode(p)}`;
    try { for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) { const t = statSync(`${dir}/${f}`).mtimeMs; if (!best || t > best[0]) best = [t, `${dir}/${f}`]; } } catch {}
  }
  return best?.[1];
}

/* ---------------------------------------------------------------- sync */

export type Synced = { path: string; branch: string; behind: number; ahead: number; result: string };

export async function sync(o: { all?: boolean; go?: boolean; only?: string[]; skip?: string[]; log?: (s: string) => void }): Promise<Synced[]> {
  const ps = await panes();
  const tops = new Set<string>();
  for (const p of ps) { const t = await gitText(p.cwd, ["rev-parse", "--show-toplevel"]); if (t) tops.add(real(t)); }
  if (o.all) for (const r of (await sh("ghq list -p")).split("\n").filter(Boolean)) tops.add(real(r));
  const out: Synced[] = [];
  for (const t of [...tops].filter((r) => (!o.only?.length || o.only.some((x) => r.includes(x))) && !o.skip?.some((x) => r.includes(x))).sort()) {
    const branch = await gitText(t, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const r = (result: string, behind = 0, ahead = 0) => out.push({ path: t, branch, behind, ahead, result });
    if (branch === "HEAD") { r("SKIP detached"); continue; }
    if (!(await gitText(t, ["rev-parse", "--abbrev-ref", "@{u}"]))) { r("SKIP no upstream"); continue; }
    o.log?.(`fetch ${t}`);
    await git(t, ["fetch", "--quiet"]);
    const [ahead, behind] = (await gitText(t, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])).split(/\s+/).map(Number);
    if (!behind) continue; // up to date (or only ahead): nothing to sync, not worth a line
    if (ahead) { r(`SKIP diverged ↑${ahead}`, behind, ahead); continue; }
    if (await gitText(t, ["status", "--porcelain", "--untracked-files=no"])) { r("SKIP modified files", behind); continue; }
    const busy = ps.filter((p) => p.agent && !IDLE.has(p.status) && (p.cwd === t || p.cwd.startsWith(t + "/")));
    if (busy.length) { r(`SKIP agent working ${busy.map((p) => p.id).join(",")}`, behind); continue; }
    if (!o.go) { r("would ff", behind); continue; }
    const m = await git(t, ["merge", "--ff-only", "--quiet", "@{u}"]);
    r(m.exitCode === 0 ? `FF ${await gitText(t, ["rev-parse", "--short", "HEAD"])}` : `FAIL ${m.stderr.toString().trim().split("\n").pop()}`, behind);
  }
  return out;
}

/* ---------------------------------------------------------------- output */

export function summary(rows: Row[]): string {
  const names: Record<Tier, string> = { A: "ghost (dir gone)", B: "merged, clean", C: "stale, pushed", D: "unsaved work", K: "keep" };
  const lines = [`${rows.length} worktrees`, ""];
  for (const t of ["A", "B", "C", "D", "K"] as Tier[]) {
    const rs = rows.filter((r) => r.tier === t);
    if (!rs.length) continue;
    lines.push(`${t}  ${names[t].padEnd(18)} ${rs.length}`);
    const show = t === "K" ? rs.slice(0, 0) : rs;
    for (const r of show) lines.push(`     ${`${r.repo}/${r.worktree}`.slice(0, 58).padEnd(58)} ${String(r.age === 99999 ? "-" : r.age + "d").padStart(5)}  ${r.why}`);
  }
  lines.push("", "fleet clean --go            prune A, remove B and C (nothing is lost)",
    "fleet clean --tier D --pr --go   also save D to rescue/<wt> branches with draft PRs");
  return lines.join("\n");
}

const TSV = ["tier", "why", "repo", "worktree", "branch", "merged", "pr", "dirty", "junk", "localOnly", "panes", "agents", "locked", "age", "path"] as const;
export const tsv = (rows: Row[]) => [TSV.join("\t"), ...rows.map((r) => TSV.map((k) => String(r[k])).join("\t"))].join("\n");

/* ---------------------------------------------------------------- CLI (also the remote entry) */

if (import.meta.main || import.meta.path.endsWith("[stdin]")) {
  const [cmd, ...a] = process.argv.slice(2);
  const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const minAge = Number(val("--min-age") ?? 3), idleShells = a.includes("--idle-shells"), idleAgents = a.includes("--idle-agents");
  const log = (s: string) => process.stderr.write(s + "\n");
  if (cmd !== "audit" && cmd !== "clean" && cmd !== "sync") { console.error("usage: worktrees.ts audit|clean|sync [...]"); process.exit(2); }
  const list = (n: string) => val(n)?.split(",").map((x) => x.trim()).filter(Boolean);
  if (cmd === "sync") {
    const res = await sync({ all: a.includes("--all"), go: a.includes("--go"), only: list("--repo"), skip: list("--skip"), log });
    if (a.includes("--json")) console.log(JSON.stringify(res));
    else {
      for (const r of res) console.log(`${r.result.split(" ")[0].padEnd(6)} ${`${r.branch} ↓${r.behind}${r.ahead ? ` ↑${r.ahead}` : ""}`.padEnd(28)} ${r.path}${r.result.includes(" ") ? `  (${r.result})` : ""}`);
      const n = (s: string) => res.filter((r) => r.result.startsWith(s)).length;
      console.log(`\n${a.includes("--go") ? `fast-forwarded ${n("FF")} · skipped ${n("SKIP")} · failed ${n("FAIL")}` : `plan only: ${n("would")} to fast-forward, ${n("SKIP")} skipped. add --go to run them.`}`);
    }
    process.exit(0);
  }
  const pick = list("--pick")?.map((x) => x.replace(/\/$/, ""));
  const rows = await audit({ minAge, idleShells, idleAgents, pick, fetch: !a.includes("--no-fetch"), only: list("--repo"), skip: list("--skip"), log });
  if (cmd === "audit") console.log(a.includes("--json") ? JSON.stringify(rows) : a.includes("--tsv") ? tsv(rows) : summary(rows));
  else {
    const tiers = (val("--tier") ?? "A,B,C").split(",").map((t) => t.trim().toUpperCase()) as Tier[];
    const signer: Signer = { host: (await sh("hostname -s")) || "local", pane: process.env.FLEET_SIGN_PANE, session: process.env.FLEET_SIGN_SESSION,
      transcript: process.env.FLEET_SIGN_TRANSCRIPT, model: process.env.FLEET_SIGN_MODEL, who: process.env.FLEET_SIGN_WHO };
    const res = await clean(rows, { tiers, go: a.includes("--go"), pr: a.includes("--pr"), minAge, idleShells, idleAgents, pick, signer, log });
    if (a.includes("--json")) console.log(JSON.stringify(res));
    else {
      for (const r of res) console.log(`${r.result.split(" ")[0].padEnd(6)} ${r.tier}  ${r.path}${r.url ? `  ${r.url}` : ""}${r.result.includes(" ") ? `  (${r.result})` : ""}`);
      const n = (s: string) => res.filter((r) => r.result.startsWith(s)).length;
      console.log(a.includes("--go") ? `\nremoved ${n("RM")} · pruned ${res.filter((r) => r.tier === "A").reduce((s, r) => s + (+r.result.split(" ")[1] || 0), 0)} · kept ${n("KEPT")} · skipped ${n("SKIP") + n("STOP")} · failed ${n("FAIL")}`
        : `\nplan only: ${res.length} actions. add --go to run them.`);
    }
  }
}
