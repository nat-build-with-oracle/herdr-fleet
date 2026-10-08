/**
 * Keeps web/dist in step with the page sources, once, at server boot.
 *
 * The console is what the tray opens and what an MCP-started server serves;
 * a fresh checkout or a pulled change must not greet either with a stale page
 * or a 503. So on boot: if any source under web/{console,compare,shared} or
 * the Vite config is newer than the built pages, rebuild. A current build
 * costs one directory walk; a rebuild takes well under a second.
 *
 * Returns null when the pages are ready, or the build's error when they are
 * not -- the server still starts, and says why a page is unavailable.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";

function newest(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const name of readdirSync(path)) max = Math.max(max, newest(`${path}/${name}`));
  return max;
}

export function ensureWebBuilt(here: string): string | null {
  const pages = [`${here}/web/dist/console/index.html`, `${here}/web/dist/compare/index.html`];
  const built = pages.every((p) => existsSync(p))
    ? Math.min(...pages.map((p) => statSync(p).mtimeMs))
    : 0;
  const sources = Math.max(
    ...["console", "compare", "shared"].map((d) => newest(`${here}/web/${d}`)),
    statSync(`${here}/vite.config.ts`).mtimeMs,
  );
  if (built && built >= sources) return null;

  const t0 = Date.now();
  const out = spawnSync("bunx", ["vite", "build"], { cwd: here, encoding: "utf8" });
  if (out.status !== 0) {
    const tail = `${out.stderr ?? ""}${out.stdout ?? ""}`.trim().split("\n").slice(-12).join("\n");
    return tail || `vite build exited ${out.status}`;
  }
  console.log(`web           built in ${Date.now() - t0}ms`);
  return null;
}
