import fs from "node:fs";
import path from "node:path";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import {
  createReactRouterRecoveryCoordinator,
  isReactRouterRouteDirectoryPath,
  isReactRouterRouteModulePath,
  registerReactRouterDevRecovery,
  type ReactRouterDiscoveryRoot,
  type ReactRouterRecoveryCoordinator,
  type ReactRouterRouteScope,
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
  routeScope: ReactRouterRouteScope;
  configFiles: string[];
}

function relativeInside(file: string, root: string): string | undefined {
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative;
}

function configCandidates(base: string): string[] {
  return CONFIG_EXTENSIONS.map((extension) => `${base}${extension}`);
}

function parseLiteralString(value: string): string | undefined {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) {
    return undefined;
  }
  const body = trimmed.slice(1, -1);
  if (/\\(?![\\'"nrtbfv0])/.test(body)) return undefined;
  return body.replace(/\\(['"\\])/g, "$1");
}

function parseLiteralStringArray(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  const values: string[] = [];
  let remaining = body;
  const literal = /^\s*((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))\s*(?:,|$)/;
  while (remaining) {
    const match = remaining.match(literal);
    if (!match) return undefined;
    const parsed = parseLiteralString(match[1]);
    if (parsed === undefined) return undefined;
    values.push(parsed);
    remaining = remaining.slice(match[0].length);
  }
  return values;
}

export function parseFlatRoutesDiscovery(
  source: string,
  appDirectory: string,
): ReactRouterDiscoveryRoot | undefined {
  const hasFsRoutesImport =
    /import\s*\{[^}]*\bflatRoutes\b[^}]*\}\s*from\s*["']@react-router\/fs-routes["']/.test(
      source,
    );
  if (!hasFsRoutesImport) return undefined;
  const call = source.match(/\bflatRoutes\s*\(\s*(\{[\s\S]*?\})?\s*\)/);
  if (!call) return undefined;
  const options = call[1];
  let rootDirectory = "routes";
  let ignoredRouteFiles: string[] = [];
  if (options) {
    if (options.includes("...")) return undefined;
    const rootMatch = options.match(/\brootDirectory\s*:\s*([^,}]+)/);
    if (rootMatch) {
      const parsed = parseLiteralString(rootMatch[1]);
      if (parsed === undefined) return undefined;
      rootDirectory = parsed;
    }
    const ignoredMatch = options.match(
      /\bignoredRouteFiles\s*:\s*(\[[\s\S]*?\])/,
    );
    if (ignoredMatch) {
      const parsed = parseLiteralStringArray(ignoredMatch[1]);
      if (!parsed) return undefined;
      ignoredRouteFiles = parsed;
    }
    if (/\brootDirectory\s*:/.test(options) && !rootMatch) return undefined;
    if (/\bignoredRouteFiles\s*:/.test(options) && !ignoredMatch)
      return undefined;
    let remaining = options.slice(1, -1);
    if (rootMatch) remaining = remaining.replace(rootMatch[0], "");
    if (ignoredMatch) remaining = remaining.replace(ignoredMatch[0], "");
    if (remaining.replace(/[\s,]/g, "")) return undefined;
  }
  const directory = path.resolve(appDirectory, rootDirectory);
  if (relativeInside(directory, appDirectory) === undefined) return undefined;
  return { appDirectory, directory, ignoredRouteFiles };
}

export function resolveReactRouterRecoveryPaths(
  config: ReactRouterResolvedConfig,
): ReactRouterRecoveryPaths | undefined {
  const context = config.__reactRouterPluginContext;
  if (!context) return undefined;
  const appDirectory = path.resolve(context.reactRouterConfig.appDirectory);
  const rootDirectory = path.resolve(context.rootDirectory);
  const routeConfigFiles = configCandidates(path.join(appDirectory, "routes"));
  const routeConfigFile = routeConfigFiles.find(fs.existsSync);
  const discoveryRoots: ReactRouterDiscoveryRoot[] = [];
  if (routeConfigFile) {
    const discovery = parseFlatRoutesDiscovery(
      fs.readFileSync(routeConfigFile, "utf8"),
      appDirectory,
    );
    if (discovery) discoveryRoots.push(discovery);
  }
  const exactRouteFiles = Object.entries(context.reactRouterConfig.routes)
    .filter(([id]) => id !== "root")
    .map(([, route]) => path.resolve(appDirectory, route.file))
    .filter((file) => relativeInside(file, appDirectory) !== undefined);
  return {
    routeScope: { exactRouteFiles, discoveryRoots },
    configFiles: [
      ...configCandidates(path.join(rootDirectory, "react-router.config")),
      ...routeConfigFiles,
    ].map((file) => path.resolve(file)),
  };
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
      coordinator = createReactRouterRecoveryCoordinator(paths.routeScope, {
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
        if (
          paths?.configFiles.includes(absolute) ||
          (paths && isReactRouterRouteModulePath(absolute, paths.routeScope))
        ) {
          schedule(absolute);
        }
      };
      const onDirectory = (directory: string) => {
        const absolute = path.resolve(directory);
        if (
          paths &&
          isReactRouterRouteDirectoryPath(absolute, paths.routeScope)
        ) {
          schedule(absolute);
        }
      };
      const onChange = (file: string) => {
        const absolute = path.resolve(file);
        if (paths?.configFiles.includes(absolute)) schedule(absolute);
      };
      server.watcher.on("add", onTopology);
      server.watcher.on("unlink", onTopology);
      server.watcher.on("addDir", onDirectory);
      server.watcher.on("unlinkDir", onDirectory);
      server.watcher.on("change", onChange);
      server.watcher.once("close", cleanup);
    },
    closeBundle: cleanup,
  };
}
