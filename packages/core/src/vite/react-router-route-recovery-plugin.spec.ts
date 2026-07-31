import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isReactRouterRouteDirectoryPath,
  isReactRouterRouteModulePath,
} from "../server/react-router-dev-recovery.js";
import {
  parseFlatRoutesDiscovery,
  reactRouterRouteRecoveryPlugin,
  resolveReactRouterRecoveryPaths,
} from "./react-router-route-recovery-plugin.js";

const tempDirs: string[] = [];

function fixture(routeConfig?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-route-plugin-"));
  tempDirs.push(root);
  const appDirectory = path.join(root, "app");
  fs.mkdirSync(appDirectory, { recursive: true });
  if (routeConfig !== undefined) {
    fs.writeFileSync(path.join(appDirectory, "routes.ts"), routeConfig);
  }
  return { root, appDirectory };
}

function resolvedConfig(
  root: string,
  routes: Record<string, { file: string }> = {
    root: { file: "root.tsx" },
    dashboard: { file: "dashboard.tsx" },
  },
) {
  return {
    __reactRouterPluginContext: {
      rootDirectory: root,
      reactRouterConfig: {
        appDirectory: path.join(root, "app"),
        routes,
      },
    },
  } as never;
}

async function flushRestart() {
  await vi.advanceTimersByTimeAsync(100);
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(500);
}

describe("React Router route recovery Vite plugin", () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs)
      fs.rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it("parses default and literal custom flatRoutes discovery options", () => {
    const { appDirectory } = fixture();
    expect(
      parseFlatRoutesDiscovery(
        'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes();',
        appDirectory,
      ),
    ).toEqual({
      appDirectory,
      directory: path.join(appDirectory, "routes"),
      ignoredRouteFiles: [],
    });
    expect(
      parseFlatRoutesDiscovery(
        `import { flatRoutes } from "@react-router/fs-routes";
        export default flatRoutes({
          rootDirectory: "pages",
          ignoredRouteFiles: ["pages/**/*.test.tsx", 'pages/private/**'],
        });`,
        appDirectory,
      ),
    ).toEqual({
      appDirectory,
      directory: path.join(appDirectory, "pages"),
      ignoredRouteFiles: ["pages/**/*.test.tsx", "pages/private/**"],
    });
  });

  it("fails closed for dynamic or out-of-app flatRoutes options", () => {
    const { appDirectory } = fixture();
    expect(
      parseFlatRoutesDiscovery(
        'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ rootDirectory });',
        appDirectory,
      ),
    ).toBeUndefined();
    expect(
      parseFlatRoutesDiscovery(
        'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ rootDirectory: getRoutes() });',
        appDirectory,
      ),
    ).toBeUndefined();
    expect(
      parseFlatRoutesDiscovery(
        'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ rootDirectory: "../outside" });',
        appDirectory,
      ),
    ).toBeUndefined();
  });

  it("keeps exact explicit routes separate from an empty custom discovery root", () => {
    const { root, appDirectory } = fixture(
      'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ rootDirectory: "pages" });\n',
    );
    const paths = resolveReactRouterRecoveryPaths(resolvedConfig(root));

    expect(paths?.routeScope.discoveryRoots).toEqual([
      {
        appDirectory,
        directory: path.join(appDirectory, "pages"),
        ignoredRouteFiles: [],
      },
    ]);
    expect(paths?.routeScope.exactRouteFiles).toEqual([
      path.join(appDirectory, "dashboard.tsx"),
    ]);
    expect(paths?.routeScope.discoveryRoots).not.toContainEqual(
      expect.objectContaining({ directory: appDirectory }),
    );
    expect(paths?.configFiles).toContain(path.join(appDirectory, "routes.mjs"));
    expect(paths?.configFiles).toContain(
      path.join(root, "react-router.config.ts"),
    );
  });

  it("treats test-named files as routes unless caller ignores them", () => {
    const { root, appDirectory } = fixture(
      'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes();\n',
    );
    const plainScope = resolveReactRouterRecoveryPaths(
      resolvedConfig(root),
    )!.routeScope;
    expect(
      isReactRouterRouteModulePath(
        path.join(appDirectory, "routes", "report.test.tsx"),
        plainScope,
      ),
    ).toBe(true);

    fs.writeFileSync(
      path.join(appDirectory, "routes.ts"),
      'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ ignoredRouteFiles: ["routes/**/*.test.tsx", "routes/**/*.spec.tsx"] });\n',
    );
    const ignoredScope = resolveReactRouterRecoveryPaths(
      resolvedConfig(root),
    )!.routeScope;
    expect(
      isReactRouterRouteModulePath(
        path.join(appDirectory, "routes", "report.test.tsx"),
        ignoredScope,
      ),
    ).toBe(false);
    expect(
      isReactRouterRouteModulePath(
        path.join(appDirectory, "routes", "report.spec.tsx"),
        ignoredScope,
      ),
    ).toBe(false);
  });

  it("matches folder ignores against the folder entry like fs-routes", () => {
    const { root, appDirectory } = fixture(
      'import { flatRoutes } from "@react-router/fs-routes";\nexport default flatRoutes({ ignoredRouteFiles: ["routes/admin", "**/route.tsx"] });\n',
    );
    const scope = resolveReactRouterRecoveryPaths(
      resolvedConfig(root),
    )!.routeScope;
    const routes = path.join(appDirectory, "routes");

    expect(
      isReactRouterRouteDirectoryPath(path.join(routes, "admin"), scope),
    ).toBe(false);
    expect(
      isReactRouterRouteModulePath(
        path.join(routes, "admin", "route.tsx"),
        scope,
      ),
    ).toBe(false);
    expect(
      isReactRouterRouteDirectoryPath(path.join(routes, "public"), scope),
    ).toBe(true);
    expect(
      isReactRouterRouteModulePath(
        path.join(routes, "public", "route.tsx"),
        scope,
      ),
    ).toBe(true);
  });

  it("uses exact route files only for unrecognized route config", () => {
    const { root, appDirectory } = fixture(
      'export default [route("dashboard", "dashboard.tsx")];\n',
    );
    const paths = resolveReactRouterRecoveryPaths(resolvedConfig(root));

    expect(paths?.routeScope.discoveryRoots).toEqual([]);
    expect(paths?.routeScope.exactRouteFiles).toEqual([
      path.join(appDirectory, "dashboard.tsx"),
    ]);
  });

  it("filters non-routes and handles exact routes plus every config event", async () => {
    vi.useFakeTimers();
    const { root, appDirectory } = fixture(
      `import { flatRoutes } from "@react-router/fs-routes";
      export default flatRoutes({
        rootDirectory: "pages",
        ignoredRouteFiles: [
          "pages/**/*.ignored.tsx",
          "pages/**/*.test.tsx",
          "pages/**/*.spec.ts",
          "pages/__tests__",
          "pages/__snapshots__",
        ],
      });\n`,
    );
    const pages = path.join(appDirectory, "pages");
    const watcher = new EventEmitter();
    const restart = vi.fn(async () => {});
    const plugin = reactRouterRouteRecoveryPlugin();
    plugin.configResolved?.(resolvedConfig(root));
    plugin.configureServer?.({
      config: { root, logger: { error: vi.fn(), info: vi.fn() } },
      restart,
      watcher,
    } as never);

    for (const file of [
      path.join(pages, "image.png"),
      path.join(pages, "route.test.tsx"),
      path.join(pages, "route.spec.ts"),
      path.join(pages, "route.tsx~"),
      path.join(pages, ".draft.tsx"),
      path.join(pages, "nested", "thing.ignored.tsx"),
      path.join(pages, "__tests__", "route.tsx"),
      path.join(pages, "__snapshots__", "route.tsx"),
    ]) {
      watcher.emit("add", file);
    }
    watcher.emit("addDir", path.join(pages, ".drafts"));
    await vi.advanceTimersByTimeAsync(150);
    expect(restart).not.toHaveBeenCalled();

    watcher.emit("add", path.join(pages, "home.mdx"));
    await flushRestart();
    expect(restart).toHaveBeenCalledTimes(1);

    watcher.emit("addDir", path.join(pages, "admin"));
    await flushRestart();
    expect(restart).toHaveBeenCalledTimes(2);

    watcher.emit("unlink", path.join(appDirectory, "dashboard.tsx"));
    await flushRestart();
    expect(restart).toHaveBeenCalledTimes(3);

    const reactRouterConfig = path.join(root, "react-router.config.ts");
    watcher.emit("add", reactRouterConfig);
    await flushRestart();
    watcher.emit("unlink", reactRouterConfig);
    await flushRestart();
    watcher.emit("add", path.join(root, "react-router.config.mjs"));
    await flushRestart();
    watcher.emit("change", path.join(appDirectory, "routes.ts"));
    await flushRestart();
    watcher.emit("unlink", path.join(appDirectory, "routes.ts"));
    await flushRestart();
    watcher.emit("add", path.join(appDirectory, "routes.mjs"));
    await flushRestart();
    expect(restart).toHaveBeenCalledTimes(9);

    watcher.emit("change", path.join(pages, "home.mdx"));
    await vi.advanceTimersByTimeAsync(150);
    expect(restart).toHaveBeenCalledTimes(9);
    watcher.emit("close");
  });
});
