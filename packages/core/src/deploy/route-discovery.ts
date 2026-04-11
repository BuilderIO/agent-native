import path from "path";

// Lazy fs — loaded via dynamic import() on first use.
// Avoids require() which bundlers convert to createRequire() that crashes on CF Workers.
let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}

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
export async function discoverFiles(
  dir: string,
  prefix = "",
): Promise<string[]> {
  try {
    const fs = await getFs();
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...(await discoverFiles(path.join(dir, entry.name), rel)));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
        files.push(rel);
      }
    }
    return files;
  } catch {
    return []; // Edge runtime — no filesystem
  }
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
export async function discoverApiRoutes(
  cwd: string,
): Promise<DiscoveredRoute[]> {
  const apiDir = path.join(cwd, "server/routes/api");
  const agentNativeDir = path.join(cwd, "server/routes/_agent-native");
  const routeFiles = [
    ...(await discoverFiles(apiDir, "api")),
    ...(await discoverFiles(agentNativeDir, "_agent-native")),
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
export async function discoverPlugins(cwd: string): Promise<string[]> {
  try {
    const fs = await getFs();
    const pluginsDir = path.join(cwd, "server/plugins");
    if (!fs.existsSync(pluginsDir)) return [];
    return fs
      .readdirSync(pluginsDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .sort()
      .map((f) => path.join(pluginsDir, f));
  } catch {
    return []; // Edge runtime — no filesystem
  }
}

/**
 * Default plugins that auto-mount when not provided by the template.
 * Key = filename stem, value = export name from @agent-native/core/server.
 */
export const DEFAULT_PLUGIN_REGISTRY: Record<string, string> = {
  "agent-chat": "defaultAgentChatPlugin",
  auth: "defaultAuthPlugin",
  "core-routes": "defaultCoreRoutesPlugin",
  integrations: "defaultIntegrationsPlugin",
  org: "defaultOrgPlugin",
  resources: "defaultResourcesPlugin",
  terminal: "defaultTerminalPlugin",
};

/** Files to skip during action discovery (mirrors action-discovery.ts). */
const SKIP_ACTION_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
]);

export interface DiscoveredAction {
  /** Action name (filename without extension) */
  name: string;
  /** Absolute path to the action file */
  absPath: string;
  /** HTTP method (from defineAction's http config, default POST) */
  method: string;
}

/**
 * Scan a single actions directory for defineAction-backed files. Shared
 * between the template-actions path and the workspace-core actions layer.
 */
async function scanActionsDir(actionsDir: string): Promise<DiscoveredAction[]> {
  const fs = await getFs();
  if (!fs.existsSync(actionsDir)) return [];

  const files = fs.readdirSync(actionsDir).filter((f) => {
    if (!f.endsWith(".ts") && !f.endsWith(".js")) return false;
    const name = f.replace(/\.(ts|js)$/, "");
    if (name.startsWith("_")) return false;
    if (SKIP_ACTION_FILES.has(name)) return false;
    return true;
  });

  const out: DiscoveredAction[] = [];
  for (const file of files) {
    const name = file.replace(/\.(ts|js)$/, "");
    const absPath = path.join(actionsDir, file);

    // Only mount actions that use defineAction. CLI-style scripts
    // (export default async function()) often use Node-only APIs
    // (fs, path) that can't run on edge runtimes — they're meant
    // to be invoked via `pnpm action <name>`, not as HTTP endpoints.
    let method = "post"; // default
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      if (!content.includes("defineAction")) continue;
      if (content.includes("http: false")) continue;
      if (
        content.includes('method: "GET"') ||
        content.includes("method: 'GET'")
      ) {
        method = "get";
      }
    } catch {
      continue;
    }

    out.push({ name, absPath, method });
  }

  return out;
}

/**
 * Discover action files in the actions/ directory.
 *
 * When a workspace core is present in the ancestor chain, its actions/
 * directory is also scanned and its actions are merged in after the
 * template's — with template actions winning on name collision.
 *
 * These become `/_agent-native/actions/:name` HTTP endpoints.
 */
export async function discoverActionFiles(
  cwd: string,
): Promise<DiscoveredAction[]> {
  const templateActions = await scanActionsDir(path.join(cwd, "actions"));
  const byName = new Map<string, DiscoveredAction>();
  for (const a of templateActions) byName.set(a.name, a);

  // Merge workspace-core actions (template wins on collision).
  try {
    const { getWorkspaceCoreExports } = await import("./workspace-core.js");
    const ws = await getWorkspaceCoreExports(cwd);
    if (ws && ws.actionsDir) {
      const wsActions = await scanActionsDir(ws.actionsDir);
      for (const a of wsActions) {
        if (!byName.has(a.name)) byName.set(a.name, a);
      }
    }
  } catch {
    // Edge runtime / no fs — skip workspace-core merge.
  }

  return Array.from(byName.values());
}

/**
 * Returns the stems of default plugins that are missing from the project.
 */
export async function getMissingDefaultPlugins(cwd: string): Promise<string[]> {
  let existingStems: Set<string>;
  try {
    const fs = await getFs();
    const pluginsDir = path.join(cwd, "server/plugins");
    existingStems = new Set(
      fs.existsSync(pluginsDir)
        ? fs
            .readdirSync(pluginsDir)
            .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
            .map((f) => path.basename(f, path.extname(f)))
        : [],
    );
  } catch {
    existingStems = new Set(); // Edge runtime — all defaults will be auto-mounted
  }
  return Object.keys(DEFAULT_PLUGIN_REGISTRY).filter(
    (stem) => !existingStems.has(stem),
  );
}
