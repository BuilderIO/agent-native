import path from "path";
import fs from "fs";

/**
 * Map a Nitro-style route file path to { method, route }.
 *
 * Examples:
 *   api/emails/index.get.ts      → GET  /api/emails
 *   api/emails/[id].get.ts       → GET  /api/emails/:id
 *   api/emails/[id]/star.patch.ts→ PATCH /api/emails/:id/star
 *   api/events.get.ts            → GET  /api/events
 */
export function parseRouteFile(relPath: string): {
  method: string;
  route: string;
} | null {
  // Strip .ts/.js extension
  const withoutExt = relPath.replace(/\.[tj]s$/, "");

  // Extract HTTP method from the last segment (e.g. "status.get" → method="get")
  const dotIdx = withoutExt.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const method = withoutExt.slice(dotIdx + 1).toLowerCase();
  const validMethods = ["get", "post", "put", "patch", "delete", "options"];
  if (!validMethods.includes(method)) return null;

  let routePath = withoutExt.slice(0, dotIdx);

  // Replace [param] with :param
  routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");

  // Replace [...catchall] with ** (H3 catch-all syntax, value in params._)
  routePath = routePath.replace(/:\.\.\.([^/]+)/g, "**");

  // Remove trailing /index
  routePath = routePath.replace(/\/index$/, "");

  // Ensure leading slash
  if (!routePath.startsWith("/")) routePath = "/" + routePath;

  return { method, route: routePath };
}

/**
 * Recursively discover all .ts files under a directory.
 */
export function discoverFiles(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...discoverFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      files.push(rel);
    }
  }
  return files;
}

export interface DiscoveredRoute {
  method: string;
  route: string;
  /** Relative path from server/routes/ */
  filePath: string;
  /** Absolute path on disk */
  absPath: string;
}

/**
 * Discover all API routes in a project's server/routes/ directory.
 */
export function discoverApiRoutes(cwd: string): DiscoveredRoute[] {
  const apiDir = path.join(cwd, "server/routes/api");
  const agentNativeDir = path.join(cwd, "server/routes/_agent-native");
  const routeFiles = [
    ...discoverFiles(apiDir, "api"),
    ...discoverFiles(agentNativeDir, "_agent-native"),
  ];
  const routes: DiscoveredRoute[] = [];

  for (const relFile of routeFiles) {
    const parsed = parseRouteFile(relFile);
    if (!parsed) continue;
    routes.push({
      ...parsed,
      filePath: relFile,
      absPath: path.join(cwd, "server/routes", relFile),
    });
  }

  return routes;
}

/**
 * Discover all server plugins in a project's server/plugins/ directory.
 */
export function discoverPlugins(cwd: string): string[] {
  const pluginsDir = path.join(cwd, "server/plugins");
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .sort()
    .map((f) => path.join(pluginsDir, f));
}

/**
 * Default plugins that auto-mount when not provided by the template.
 * Key = filename stem, value = export name from @agent-native/core/server.
 */
export const DEFAULT_PLUGIN_REGISTRY: Record<string, string> = {
  "agent-chat": "defaultAgentChatPlugin",
  auth: "defaultAuthPlugin",
  "core-routes": "defaultCoreRoutesPlugin",
  "file-sync": "defaultFileSyncPlugin",
  resources: "defaultResourcesPlugin",
  terminal: "defaultTerminalPlugin",
};

/**
 * Returns the stems of default plugins that are missing from the project.
 */
export function getMissingDefaultPlugins(cwd: string): string[] {
  const pluginsDir = path.join(cwd, "server/plugins");
  const existingStems = new Set(
    fs.existsSync(pluginsDir)
      ? fs
          .readdirSync(pluginsDir)
          .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
          .map((f) => path.basename(f, path.extname(f)))
      : [],
  );
  return Object.keys(DEFAULT_PLUGIN_REGISTRY).filter(
    (stem) => !existingStems.has(stem),
  );
}
