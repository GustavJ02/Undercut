/** Vite plugin for development: serves `/mods/index.json` (the packs found, validated) and `/mods/<source>/<folder>/<file>`, and tells the
 * page to reload its packs when something under a mods folder changes (hot reload). The production server needs the same two routes
 * (request R3 in docs/requests/presentation-to-backend.md). */
import type { Plugin } from "vite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { packRoots } from "../src/packs/readDir";
import { resolveModRequest, scanMods, type Roots } from "./modsServer";

export function modsRoots(repoRoot: string): Roots {
  const [examples, local, user] = packRoots(repoRoot);
  return { examples, local, user };
}

export function modsPlugin(repoRoot = resolve(__dirname, "../..")): Plugin {
  const roots = modsRoots(repoRoot);
  return {
    name: "undercut-mods",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/mods", (req, res, next) => {
        const url = req.url ?? "/";
        if (url.split("?")[0] === "/index.json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ packs: scanMods(roots) }));
          return;
        }
        const r = resolveModRequest(roots, url);
        if (r.status !== 200) {
          res.statusCode = r.status;
          res.end();
          return;
        }
        res.setHeader("Content-Type", r.type!);
        res.setHeader("Cache-Control", "no-store");
        res.end(r.body);
      });
      const dirs = Object.values(roots).filter((d) => existsSync(d));
      server.watcher.add(dirs);
      const changed = (file: string) => {
        if (dirs.some((d) => file.startsWith(d))) server.ws.send({ type: "custom", event: "undercut:mods-changed" });
      };
      server.watcher.on("add", changed).on("change", changed).on("unlink", changed);
    },
  };
}
