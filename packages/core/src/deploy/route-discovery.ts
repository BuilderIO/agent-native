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
      .filter(isRuntimeSourceFile)
      .sort()
      .map((f) => path.join(pluginsDir, f));
  } catch {
    return []; // Edge runtime — no filesystem
  }
}

function isRuntimeSourceFile(filename: string): boolean {
  if (!/\.(ts|js)$/.test(filename)) return false;
  if (/\.d\.ts$/.test(filename)) return false;
  if (/\.(test|spec)\.(ts|js)$/.test(filename)) return false;
  return true;
}

/**
 * Default plugins that auto-mount when not provided by the template.
 * Key = filename stem, value = export name from @agent-native/core/server.
 */
export const DEFAULT_PLUGIN_REGISTRY: Record<string, string> = {
  "agent-chat": "defaultAgentChatPlugin",
  auth: "defaultAuthPlugin",
  "context-xray": "defaultContextXrayPlugin",
  "core-routes": "defaultCoreRoutesPlugin",
  integrations: "defaultIntegrationsPlugin",
  "observational-memory": "defaultObservationalMemoryPlugin",
  onboarding: "defaultOnboardingPlugin",
  org: "defaultOrgPlugin",
  resources: "defaultResourcesPlugin",
  sentry: "defaultSentryPlugin",
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
  /**
   * Custom route segment from defineAction's `http.path`. When unset the
   * route falls back to `name`, mirroring the runtime mount
   * (`action-routes.ts`: `path = http?.path ?? name`).
   */
  path?: string;
}

/** HTTP methods an action may expose via `http.method`. */
const VALID_ACTION_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

/**
 * Statically extract the `http` config from a defineAction source file.
 *
 * Deploy discovery cannot import the action module — edge bundlers rewrite
 * require()/import in ways that crash (see getFs note above), and action
 * files often pull in Node-only deps — so we parse the source text instead.
 * The parse is scoped to the `http: { ... }` object literal so unrelated
 * `method:`/`path:` keys elsewhere in the file (e.g. a
 * `fetch(url, { method: "GET" })` in the action body) cannot flip the
 * route's method. A naive `content.includes('method: "GET"')` did exactly
 * that, and it also missed PUT/PATCH/DELETE and dropped `http.path`.
 *
 * The http config may contain nested object literals before `method` or
 * `path`, so extract the object body with a small balanced-brace scan rather
 * than a non-greedy regex that stops at the first closing brace.
 *
 * Returns `false` when the action opts out of HTTP (`http: false`); otherwise
 * `{ method, path? }` with method lowercased and defaulting to "post".
 */
export function parseActionHttpConfig(
  content: string,
): false | { method: string; path?: string } {
  let method = "post";
  let path: string | undefined;

  const httpConfig = extractActionHttpConfig(content);
  if (httpConfig === false) return false;

  if (typeof httpConfig === "string") {
    const body = httpConfig;
    const methodMatch = body.match(/\bmethod\s*:\s*['"]([A-Za-z]+)['"]/);
    if (methodMatch) {
      const m = methodMatch[1].toLowerCase();
      if (VALID_ACTION_METHODS.has(m)) method = m;
    }
    const pathMatch = body.match(/\bpath\s*:\s*['"]([^'"]+)['"]/);
    if (pathMatch) path = pathMatch[1];
  }

  return { method, path };
}

function extractActionHttpConfig(content: string): false | string | undefined {
  for (let i = 0; i < content.length; ) {
    const skipped = skipNonCode(content, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    if (
      content.startsWith("http", i) &&
      !isIdentifierChar(content[i - 1]) &&
      !isIdentifierChar(content[i + 4])
    ) {
      let valueStart = skipWhitespaceAndComments(content, i + 4);
      if (content[valueStart] !== ":") {
        i += 4;
        continue;
      }

      valueStart = skipWhitespaceAndComments(content, valueStart + 1);
      if (
        content.startsWith("false", valueStart) &&
        !isIdentifierChar(content[valueStart + 5])
      ) {
        return false;
      }

      if (content[valueStart] === "{") {
        return extractBalancedObjectBody(content, valueStart);
      }
    }

    i += 1;
  }

  return undefined;
}

function extractBalancedObjectBody(
  content: string,
  openBraceIndex: number,
): string | undefined {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; ) {
    const skipped = skipNonCode(content, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const ch = content[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(openBraceIndex + 1, i);
    }

    i += 1;
  }

  return undefined;
}

function skipWhitespaceAndComments(content: string, start: number): number {
  let i = start;
  while (i < content.length) {
    if (/\s/.test(content[i])) {
      i += 1;
      continue;
    }

    const skipped = skipComment(content, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    break;
  }
  return i;
}

function skipNonCode(content: string, start: number): number {
  return skipComment(content, skipString(content, start));
}

function skipComment(content: string, start: number): number {
  if (content[start] === "/" && content[start + 1] === "/") {
    const newline = content.indexOf("\n", start + 2);
    return newline === -1 ? content.length : newline + 1;
  }

  if (content[start] === "/" && content[start + 1] === "*") {
    const close = content.indexOf("*/", start + 2);
    return close === -1 ? content.length : close + 2;
  }

  return start;
}

function skipString(content: string, start: number): number {
  const quote = content[start];
  if (quote !== "'" && quote !== '"' && quote !== "`") return start;

  for (let i = start + 1; i < content.length; i += 1) {
    if (content[i] === "\\") {
      i += 1;
      continue;
    }
    if (content[i] === quote) return i + 1;
  }

  return content.length;
}

function isIdentifierChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Scan a single actions directory for defineAction-backed files. Shared
 * between the template-actions path and the workspace-core actions layer.
 */
async function scanActionsDir(actionsDir: string): Promise<DiscoveredAction[]> {
  const fs = await getFs();
  if (!fs.existsSync(actionsDir)) return [];

  const files = fs.readdirSync(actionsDir).filter((f) => {
    if (!isRuntimeSourceFile(f)) return false;
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
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    if (!content.includes("defineAction")) continue;

    const http = parseActionHttpConfig(content);
    if (http === false) continue; // agent-only

    out.push({
      name,
      absPath,
      method: http.method,
      ...(http.path ? { path: http.path } : {}),
    });
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
            .filter(isRuntimeSourceFile)
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
