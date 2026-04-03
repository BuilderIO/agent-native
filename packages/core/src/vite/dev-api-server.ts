import path from "path";
import fs from "fs";
import { createApp, createRouter, toNodeListener } from "h3";
import type { Plugin, ViteDevServer } from "vite";
import {
  DEFAULT_PLUGIN_REGISTRY,
  getMissingDefaultPlugins,
} from "../deploy/route-discovery.js";
import {
  defaultCoreRoutesPlugin,
  defaultResourcesPlugin,
  defaultFileSyncPlugin,
  defaultAuthPlugin,
  defaultAgentChatPlugin,
} from "../server/index.js";
import { defaultTerminalPlugin } from "../terminal/terminal-plugin.js";

const DEFAULT_PLUGIN_IMPLEMENTATIONS: Record<
  string,
  (nitroApp: any) => void | Promise<void>
> = {
  "agent-chat": defaultAgentChatPlugin,
  auth: defaultAuthPlugin,
  "core-routes": defaultCoreRoutesPlugin,
  "file-sync": defaultFileSyncPlugin,
  resources: defaultResourcesPlugin,
  terminal: defaultTerminalPlugin,
};

/**
 * Map a Nitro-style route file path to { method, route }.
 *
 * Examples:
 *   api/emails/index.get.ts      → GET  /api/emails
 *   api/emails/[id].get.ts       → GET  /api/emails/:id
 *   api/emails/[id]/star.patch.ts→ PATCH /api/emails/:id/star
 *   api/events.get.ts            → GET  /api/events
 */
function parseRouteFile(relPath: string): {
  method: string;
  route: string;
} | null {
  // Strip .ts extension
  const withoutExt = relPath.replace(/\.ts$/, "");

  // Extract HTTP method from the last segment (e.g. "status.get" → method="get")
  const dotIdx = withoutExt.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const method = withoutExt.slice(dotIdx + 1).toLowerCase();
  const validMethods = ["get", "post", "put", "patch", "delete", "options"];
  if (!validMethods.includes(method)) return null;

  let routePath = withoutExt.slice(0, dotIdx);

  // Replace [param] with :param
  routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");

  // Remove trailing /index
  routePath = routePath.replace(/\/index$/, "");

  // Ensure leading slash
  if (!routePath.startsWith("/")) routePath = "/" + routePath;

  return { method, route: routePath };
}

/**
 * Recursively discover all .ts files under a directory.
 */
function discoverFiles(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...discoverFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts")) {
      files.push(rel);
    }
  }
  return files;
}

/**
 * Load all API routes and server plugins, return an H3 listener.
 */
async function buildApiListener(
  server: ViteDevServer,
  cwd: string,
): Promise<ReturnType<typeof toNodeListener>> {
  const apiDir = path.join(cwd, "server/routes/api");
  const pluginsDir = path.join(cwd, "server/plugins");

  const app = createApp();
  const router = createRouter();
  app.use(router);

  // Discover and register API route files
  const routeFiles = discoverFiles(apiDir, "api");
  let registered = 0;

  for (const relFile of routeFiles) {
    const parsed = parseRouteFile(relFile);
    if (!parsed) continue;

    const absPath = path.join(cwd, "server/routes", relFile);

    try {
      const mod = await server.ssrLoadModule(`/${path.relative(cwd, absPath)}`);
      const handler = mod.default;
      if (typeof handler !== "function") continue;

      const routerMethod = router[parsed.method as keyof typeof router];
      if (typeof routerMethod === "function") {
        (routerMethod as Function).call(router, parsed.route, handler);
        registered++;
      }
    } catch (e) {
      console.warn(
        `[dev-api-server] Failed to load route ${relFile}:`,
        (e as Error).message,
      );
    }
  }

  // Run server plugins (auth, file-sync, etc.)
  // Build a unified sorted list of user-provided + auto-mounted default plugins.
  {
    const userPluginFiles = fs.existsSync(pluginsDir)
      ? fs
          .readdirSync(pluginsDir)
          .filter((f) => f.endsWith(".ts"))
          .sort()
      : [];
    const userStems = new Set(
      userPluginFiles.map((f) => path.basename(f, path.extname(f))),
    );
    const missingDefaults = Object.keys(DEFAULT_PLUGIN_REGISTRY).filter(
      (stem) => !userStems.has(stem),
    );

    type PluginEntry =
      | { type: "file"; file: string }
      | { type: "default"; stem: string };
    const allPlugins: PluginEntry[] = [
      ...userPluginFiles.map((file) => ({ type: "file", file }) as PluginEntry),
      ...missingDefaults.map(
        (stem) => ({ type: "default", stem }) as PluginEntry,
      ),
    ];
    allPlugins.sort((a, b) => {
      const aName =
        a.type === "file"
          ? path.basename(a.file, path.extname(a.file))
          : a.stem;
      const bName =
        b.type === "file"
          ? path.basename(b.file, path.extname(b.file))
          : b.stem;
      return aName.localeCompare(bName);
    });

    for (const entry of allPlugins) {
      if (entry.type === "file") {
        try {
          const absPath = path.join(pluginsDir, entry.file);
          const mod = await server.ssrLoadModule(
            `/${path.relative(cwd, absPath)}`,
          );
          const plugin = mod.default;
          if (typeof plugin === "function") {
            await plugin({ h3App: app });
          }
        } catch (e) {
          console.warn(
            `[dev-api-server] Failed to load plugin ${entry.file}:`,
            (e as Error).message,
          );
        }
      } else {
        const defaultPlugin = DEFAULT_PLUGIN_IMPLEMENTATIONS[entry.stem];
        if (typeof defaultPlugin === "function") {
          try {
            await defaultPlugin({ h3App: app });
          } catch (e) {
            console.warn(
              `[dev-api-server] Failed to auto-mount default plugin ${entry.stem}:`,
              (e as Error).message,
            );
          }
        }
      }
    }

    if (missingDefaults.length > 0) {
      console.log(
        `[dev-api-server] Auto-mounted ${missingDefaults.length} default plugin(s): ${missingDefaults.join(", ")}`,
      );
    }
  }

  console.log(`[dev-api-server] ${registered} API routes registered`);
  return toNodeListener(app);
}

/**
 * Vite plugin that serves H3 API routes from server/routes/api/ during dev.
 *
 * This replaces the disabled Nitro Vite plugin for dev-mode API route serving.
 * It scans the file-based routes, imports them, and mounts them on an H3 app
 * that handles /api/* and /_agent-native/* requests before React Router's SSR handler.
 */
export function devApiServer(): Plugin {
  return {
    name: "agent-native-dev-api-server",
    apply: "serve",

    configureServer(server) {
      const cwd = server.config.root || process.cwd();
      const apiDir = path.join(cwd, "server/routes/api");
      const serverDir = path.join(cwd, "server");

      // Skip if no API routes directory exists
      if (!fs.existsSync(apiDir)) return;

      // Lazily initialize the H3 listener on first /api/ request.
      // This avoids blocking server startup and ensures ssrLoadModule is ready.
      let listenerPromise: Promise<ReturnType<typeof toNodeListener>> | null =
        null;

      // Watch server/ directory for changes and invalidate the listener
      // so it rebuilds on the next API request (no full restart needed).
      if (fs.existsSync(serverDir)) {
        const watcher = fs.watch(
          serverDir,
          { recursive: true },
          (_, filename) => {
            if (filename && filename.endsWith(".ts")) {
              listenerPromise = null;
              console.log(
                `[dev-api-server] Server file changed: ${filename} — will reload on next request`,
              );
            }
          },
        );
        server.httpServer?.on("close", () => watcher.close());
      }

      // Add middleware DIRECTLY (not via return) so it runs BEFORE
      // Vite's internal middleware and React Router's SSR handler.
      // Reject /.well-known/ requests (Chrome DevTools probes, etc.)
      // before React Router's SSR handler sees them and throws.
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/.well-known/")) {
          res.statusCode = 404;
          res.end();
          return;
        }
        return next();
      });

      server.middlewares.use((req, res, next) => {
        if (
          !req.url?.startsWith("/api/") &&
          !req.url?.startsWith("/_agent-native/")
        ) {
          return next();
        }

        if (!listenerPromise) {
          listenerPromise = buildApiListener(server, cwd);
        }

        listenerPromise
          .then((listener) => listener(req, res))
          .catch((err) => {
            console.error("[dev-api-server] Error handling request:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Internal server error" }));
          });
      });
    },
  };
}
