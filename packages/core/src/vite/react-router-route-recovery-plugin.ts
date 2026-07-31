import fs from "node:fs";
import path from "node:path";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import {
  createReactRouterRecoveryCoordinator,
  registerReactRouterDevRecovery,
  type ReactRouterRecoveryCoordinator,
} from "../server/react-router-dev-recovery.js";

const ROUTE_RESTART_DEBOUNCE_MS = 100;
const CONFIG_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

interface ReactRouterPluginContext {
  rootDirectory: string;
  reactRouterConfig: {
    appDirectory: string;
    routes: Record<string, { file: string }>;
  };
}

type ReactRouterResolvedConfig = ResolvedConfig & {
  __reactRouterPluginContext?: ReactRouterPluginContext;
};

export interface ReactRouterRecoveryPaths {
  routeRoots: string[];
  configFiles: string[];
}

function existingConfigCandidate(base: string): string[] {
  return CONFIG_EXTENSIONS.map((extension) => `${base}${extension}`).filter(
    fs.existsSync,
  );
}

export function resolveReactRouterRecoveryPaths(
  config: ReactRouterResolvedConfig,
): ReactRouterRecoveryPaths | undefined {
  const context = config.__reactRouterPluginContext;
  if (!context) return undefined;
  const appDirectory = path.resolve(context.reactRouterConfig.appDirectory);
  const routeRoots = new Set<string>([path.join(appDirectory, "routes")]);
  for (const [id, route] of Object.entries(context.reactRouterConfig.routes)) {
    if (id === "root") continue;
    routeRoots.add(path.dirname(path.resolve(appDirectory, route.file)));
  }
  const configFiles = new Set<string>([
    ...CONFIG_EXTENSIONS.map((extension) =>
      path.join(context.rootDirectory, `react-router.config${extension}`),
    ),
    ...existingConfigCandidate(path.join(appDirectory, "routes")),
  ]);
  return {
    routeRoots: [...routeRoots].map((root) => path.resolve(root)),
    configFiles: [...configFiles].map((file) => path.resolve(file)),
  };
}

function isWithin(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function reactRouterRouteRecoveryPlugin(): Plugin {
  let paths: ReactRouterRecoveryPaths | undefined;
  let coordinator: ReactRouterRecoveryCoordinator | undefined;
  let unregister: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    unregister?.();
    unregister = undefined;
    coordinator?.dispose();
    coordinator = undefined;
  };

  return {
    name: "agent-native-react-router-route-recovery",
    apply: "serve",
    configResolved(config) {
      paths = resolveReactRouterRecoveryPaths(
        config as ReactRouterResolvedConfig,
      );
    },
    configureServer(server: ViteDevServer) {
      if (!paths || process.env.NODE_ENV === "production") return;
      cleanup();
      coordinator = createReactRouterRecoveryCoordinator(paths.routeRoots, {
        restart: () => server.restart(),
        persistentStateKey: server.config.root,
        onOutcome(message, error) {
          if (error) {
            const detail = error instanceof Error ? `: ${error.message}` : "";
            server.config.logger.error(`[agent-native] ${message}${detail}`);
          } else {
            server.config.logger.info(`[agent-native] ${message}`);
          }
        },
      });
      unregister = registerReactRouterDevRecovery(coordinator);
      const schedule = (file: string) => {
        if (!coordinator) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          coordinator?.requestTopology(path.relative(server.config.root, file));
        }, ROUTE_RESTART_DEBOUNCE_MS);
        timer.unref?.();
      };
      const onTopology = (file: string) => {
        const absolute = path.resolve(file);
        if (paths?.routeRoots.some((root) => isWithin(absolute, root))) {
          schedule(absolute);
        }
      };
      const onChange = (file: string) => {
        const absolute = path.resolve(file);
        if (paths?.configFiles.includes(absolute)) schedule(absolute);
      };
      server.watcher.on("add", onTopology);
      server.watcher.on("unlink", onTopology);
      server.watcher.on("addDir", onTopology);
      server.watcher.on("unlinkDir", onTopology);
      server.watcher.on("change", onChange);
      server.watcher.once("close", cleanup);
    },
    closeBundle: cleanup,
  };
}
