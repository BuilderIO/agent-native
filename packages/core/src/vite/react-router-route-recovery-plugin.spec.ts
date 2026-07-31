import { EventEmitter } from "node:events";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reactRouterRouteRecoveryPlugin,
  resolveReactRouterRecoveryPaths,
} from "./react-router-route-recovery-plugin.js";

function resolvedConfig(root: string) {
  const appDirectory = path.join(root, "web");
  return {
    __reactRouterPluginContext: {
      rootDirectory: root,
      reactRouterConfig: {
        appDirectory,
        routes: {
          root: { file: "root.tsx" },
          dashboard: { file: "screens/dashboard.tsx" },
        },
      },
    },
  } as never;
}

describe("React Router route recovery Vite plugin", () => {
  afterEach(() => vi.useRealTimers());

  it("derives route roots and config inputs from React Router's resolved context", () => {
    const root = path.resolve("/workspace/app");
    const paths = resolveReactRouterRecoveryPaths(resolvedConfig(root));

    expect(paths?.routeRoots).toEqual(
      expect.arrayContaining([
        path.join(root, "web", "routes"),
        path.join(root, "web", "screens"),
      ]),
    );
    expect(paths?.configFiles).toContain(
      path.join(root, "react-router.config.ts"),
    );
    expect(paths?.routeRoots).not.toContain(path.join(root, "web"));
  });

  it("debounces topology bursts and ignores ordinary route changes", async () => {
    vi.useFakeTimers();
    const root = path.resolve("/workspace/app");
    const watcher = new EventEmitter();
    const restart = vi.fn(async () => {});
    const plugin = reactRouterRouteRecoveryPlugin();
    const config = resolvedConfig(root);
    plugin.configResolved?.(config);
    plugin.configureServer?.({
      config: {
        root,
        logger: { error: vi.fn(), info: vi.fn() },
      },
      restart,
      watcher,
    } as never);

    watcher.emit("change", path.join(root, "web", "routes", "home.tsx"));
    await vi.advanceTimersByTimeAsync(150);
    expect(restart).not.toHaveBeenCalled();

    watcher.emit("unlink", path.join(root, "web", "routes", "old.tsx"));
    watcher.emit("add", path.join(root, "web", "routes", "new.tsx"));
    watcher.emit("addDir", path.join(root, "web", "routes", "admin"));
    await vi.advanceTimersByTimeAsync(99);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restart).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(500);
    watcher.emit("change", path.join(root, "react-router.config.ts"));
    await vi.advanceTimersByTimeAsync(100);
    expect(restart).toHaveBeenCalledTimes(2);
    watcher.emit("close");
  });
});
