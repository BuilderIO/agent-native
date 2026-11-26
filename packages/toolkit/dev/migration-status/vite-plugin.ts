import path from "node:path";

import type { Plugin } from "vite";

import { defaultApps, scanMigration } from "./scan.js";

const ID = "virtual:migration-status";
const RESOLVED = `\0${ID}`;

/**
 * Serves `virtual:migration-status`: the scan of this checkout, run when the
 * page first loads. While Storybook runs, an edit to any scanned file rescans
 * and hot-updates the page.
 */
export function migrationStatus(repo: string): Plugin {
  return {
    name: "agent-native:migration-status",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const status = scanMigration(repo);
      return `export default ${JSON.stringify(status)};`;
    },
    configureServer(server) {
      const roots = defaultApps(repo).flatMap((app) =>
        app.roots.map((root) => path.join(repo, root.dir)),
      );
      server.watcher.add(roots);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = (file: string) => {
        if (!/\.[jt]sx?$/.test(file)) return;
        if (!roots.some((root) => file.startsWith(`${root}${path.sep}`))) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          const module = server.moduleGraph.getModuleById(RESOLVED);
          if (module) void server.reloadModule(module);
        }, 1500);
      };
      server.watcher.on("add", changed);
      server.watcher.on("change", changed);
      server.watcher.on("unlink", changed);
    },
  };
}
