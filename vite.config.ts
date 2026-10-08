/**
 * Vite build for both web pages -- the console (/) and compare (/compare).
 *
 * One Vite project, two entries, one shared module tree:
 *
 *   web/console/   the console        -> served at /
 *   web/compare/   local vs a machine -> served at /compare
 *   web/shared/    what both pages use: theme, primitives, hooks
 *
 *   bun run web:build  emits web/dist; server.ts serves it (and builds it
 *                         itself on boot when the sources are newer)
 *   bun run web:dev    vite on :5173 with HMR, /api proxied to the server
 *
 * In the built form page and API share an origin, so there is no CORS and
 * no token plumbing beyond the one <meta> tag the server fills in.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = process.env.FLEET_SERVER ?? "http://127.0.0.1:4320";

/**
 * Development only: give the dev server the production server's manners.
 *
 *  - The console needs the action token in its <meta> tag. The fleet server
 *    fills it in when it serves the page; here the page comes from Vite, so
 *    this does the same from the running server's runtime.json. The token is
 *    never added by the proxy instead -- a proxy that adds it would hand it to
 *    any site able to POST to 127.0.0.1:5173.
 *  - "/" and "/compare" are the production paths the pages link to; map them
 *    onto the entry directories Vite actually serves.
 */
function devParity(): Plugin {
  return {
    name: "fleet-dev-parity",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const to = req.url === "/" ? "/console/" : req.url === "/compare" ? "/compare/" : null;
        if (!to) return next();
        res.statusCode = 302;
        res.setHeader("location", to);
        res.end();
      });
    },
    transformIndexHtml(html) {
      try {
        const rt = JSON.parse(readFileSync(resolve(HERE, ".tmp/runtime.json"), "utf8"));
        return html.replace("__FLEET_TOKEN__", rt.token);
      } catch {
        return html; // no server running yet: reads work, actions say why they cannot
      }
    },
  };
}

export default defineConfig({
  root: resolve(HERE, "web"),
  base: "/",
  appType: "mpa",
  plugins: [react(), tailwindcss(), devParity()],
  build: {
    outDir: resolve(HERE, "web/dist"),
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        console: resolve(HERE, "web/console/index.html"),
        compare: resolve(HERE, "web/compare/index.html"),
      },
      // the one non-entry chunk is React plus web/shared -- what both pages
      // load and cache once. Left to itself Rolldown names it after whichever
      // module it met first, which read as if it held only that component.
      output: { chunkFileNames: "assets/shared-[hash].js" },
    },
  },
  server: {
    port: 5173,
    // 127.0.0.1 only, like the server it talks to -- these pages can read the
    // whole fleet's layout and have no business being reachable off-box
    host: "127.0.0.1",
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
});
