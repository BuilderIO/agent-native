import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";

const DEFAULT_BRIDGE_PORT = 7331;
const ROUTE_MANIFEST_FILE = path.join(".agent-native", "design-routes.json");
const DEFAULT_DEV_SERVER_CANDIDATES = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
];

const BRIDGE_OPERATIONS = [
  "select",
  "resolveNodeToFile",
  "readFile",
  "applyEdit",
  "writeFile",
  "captureSnapshot",
  "captureState",
  "listFiles",
] as const;

type BridgeOperation = (typeof BRIDGE_OPERATIONS)[number];

const SERVER_REGISTRATION_BRIDGE_OPERATIONS = new Set<BridgeOperation>([
  "select",
  "resolveNodeToFile",
  "readFile",
  "applyEdit",
  "writeFile",
  "captureSnapshot",
  "captureState",
]);

/** Additive manifest capability flags advertised alongside the operation list. */
const MANIFEST_CAPABILITIES = {
  listFiles: true,
  readTextFiles: true,
  writeTextFiles: true,
} as const;

export interface DesignConnectArgs {
  url?: string;
  port: number;
  root: string;
  routeManifest?: string;
  /** Optional deployed design app URL used to self-register the bridge on
   *  startup.  When set (or when AGENT_NATIVE_URL / DESIGN_APP_URL env vars
   *  are present) the CLI POSTs to `/_agent-native/actions/connect-localhost`
   *  with the real bridge token so the server can store it for grant minting. */
  appUrl?: string;
  json: boolean;
  once: boolean;
  dryRun: boolean;
  daemon: boolean;
  help: boolean;
}

export interface DesignConnectRoute {
  id: string;
  path: string;
  title: string;
  sourceFile?: string;
  sourceKind: "react-router" | "html" | "manual";
}

export interface DesignConnectManifest {
  version: 1;
  source: "agent-native-design-connect";
  sourceType: "localhost";
  localOnly: true;
  devServerUrl: string;
  bridgeUrl: string;
  rootPath: string;
  routeManifestPath: string;
  routeManifestCreated: boolean;
  routes: DesignConnectRoute[];
  routeCount: number;
  generatedAt: string;
  capabilities: Array<{
    operation: BridgeOperation;
    status: "available" | "planned" | "disabled";
    reason?: string;
  }>;
  /**
   * Additive high-level capability flags beyond the low-level operation list.
   * `connect-localhost` persists this so `list-design-source-capabilities` can
   * reflect readFile/writeFile/listFiles availability for localhost sources.
   */
  manifestCapabilities: typeof MANIFEST_CAPABILITIES;
}

export interface DesignConnectBridge {
  server: Server;
  manifest: DesignConnectManifest;
  /** Per-rootPath bridge token. Kept in-process only; never serialised into
   *  the manifest JSON so it is not exposed over the network via GET /manifest.
   *  The server-side grant action reads it from the running bridge instance. */
  bridgeToken: string;
}

function stringFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
}

function normalizeHttpUrl(value: string): string {
  const raw = value.trim();
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--url must be an http(s) URL");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function parseDesignConnectArgs(argv: string[]): DesignConnectArgs {
  const args = argv[0] === "connect" ? argv.slice(1) : argv;
  const parsed: DesignConnectArgs = {
    port: DEFAULT_BRIDGE_PORT,
    root: process.cwd(),
    json: false,
    once: false,
    dryRun: false,
    daemon: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "help" || arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--url") {
      parsed.url = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--url=")) {
      parsed.url = arg.slice("--url=".length);
    } else if (arg === "--port") {
      parsed.port = Number.parseInt(stringFlagValue(args, index, arg), 10);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      parsed.port = Number.parseInt(arg.slice("--port=".length), 10);
    } else if (arg === "--root") {
      parsed.root = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--root=")) {
      parsed.root = arg.slice("--root=".length);
    } else if (arg === "--route-manifest") {
      parsed.routeManifest = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--route-manifest=")) {
      parsed.routeManifest = arg.slice("--route-manifest=".length);
    } else if (arg === "--app-url") {
      parsed.appUrl = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--app-url=")) {
      parsed.appUrl = arg.slice("--app-url=".length);
    } else if (arg === "--json") {
      parsed.json = true;
      parsed.once = true;
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.once = true;
    } else if (arg === "--daemon") {
      parsed.daemon = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive integer");
  }
  if (parsed.daemon && (parsed.json || parsed.once || parsed.dryRun)) {
    throw new Error(
      "--daemon cannot be combined with --json, --once, or --dry-run",
    );
  }
  parsed.root = path.resolve(parsed.root);
  parsed.url = parsed.url ? normalizeHttpUrl(parsed.url) : undefined;
  return parsed;
}

function routeId(routePath: string): string {
  if (routePath === "/") return "route-root";
  const slug = routePath
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug ? `route-${slug}` : "route-wildcard";
}

function titleFromRoutePath(routePath: string): string {
  if (routePath === "/") return "Home";
  if (routePath === "/*" || routePath === "*") return "Wildcard";
  return (
    routePath
      .replace(/^\/+/, "")
      .replace(/[:$]/g, "")
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Screen"
  );
}

function walkFiles(dir: string, files: string[] = []): string[] {
  if (!fsSync.existsSync(dir)) return files;
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, files);
    } else {
      files.push(absolute);
    }
  }
  return files;
}

function routePathFromReactRouterFile(filePath: string, routesDir: string) {
  const withoutExt = normalizeSlash(path.relative(routesDir, filePath)).replace(
    /\.[cm]?[jt]sx?$/,
    "",
  );
  const parts: string[] = [];
  for (const segment of withoutExt.split("/")) {
    for (const token of segment.split(".")) {
      if (!token || token === "route" || token === "index") continue;
      if (token === "_index") continue;
      if (token.startsWith("_")) continue;
      const pathToken = token.endsWith("_") ? token.slice(0, -1) : token;
      if (pathToken === "$") {
        parts.push("*");
      } else if (pathToken.startsWith("$")) {
        const param = pathToken.slice(1) || "param";
        parts.push(`:${param}`);
      } else {
        parts.push(pathToken);
      }
    }
  }
  return `/${parts.join("/")}`.replace(/\/+/g, "/");
}

export function discoverDesignRoutes(root: string): DesignConnectRoute[] {
  const absoluteRoot = path.resolve(root);
  const routeDirs = [
    path.join(absoluteRoot, "app", "routes"),
    path.join(absoluteRoot, "src", "routes"),
    path.join(absoluteRoot, "pages"),
  ].filter((dir) => fsSync.existsSync(dir));
  const routes = new Map<string, DesignConnectRoute>();

  for (const routeDir of routeDirs) {
    for (const file of walkFiles(routeDir)) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      if (/\.test\.|\.spec\./.test(file)) continue;
      const pathName = routePathFromReactRouterFile(file, routeDir);
      routes.set(pathName, {
        id: routeId(pathName),
        path: pathName,
        title: titleFromRoutePath(pathName),
        sourceFile: normalizeSlash(path.relative(absoluteRoot, file)),
        sourceKind: "react-router",
      });
    }
  }

  if (routes.size === 0) {
    for (const dir of [absoluteRoot, path.join(absoluteRoot, "public")]) {
      for (const file of walkFiles(dir)) {
        if (!file.endsWith(".html")) continue;
        const rel = normalizeSlash(path.relative(dir, file));
        const pathName =
          rel === "index.html" ? "/" : `/${rel.replace(/\.html$/, "")}`;
        routes.set(pathName, {
          id: routeId(pathName),
          path: pathName,
          title: titleFromRoutePath(pathName),
          sourceFile: normalizeSlash(path.relative(absoluteRoot, file)),
          sourceKind: "html",
        });
      }
    }
  }

  return [...routes.values()].sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.localeCompare(b.path);
  });
}

async function probeDevServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForBridgeHealth(
  bridgeUrl: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const healthUrl = new URL("/health", bridgeUrl).toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 400);
    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
      });
      if (response.ok) return true;
    } catch {
      // Keep polling until the detached process finishes binding the port.
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function isDesignConnectManifest(
  value: unknown,
): value is DesignConnectManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<DesignConnectManifest>;
  return (
    manifest.version === 1 &&
    manifest.source === "agent-native-design-connect" &&
    manifest.sourceType === "localhost" &&
    manifest.localOnly === true &&
    typeof manifest.devServerUrl === "string" &&
    typeof manifest.bridgeUrl === "string" &&
    typeof manifest.rootPath === "string"
  );
}

async function fetchRunningBridgeManifest(
  bridgeUrl: string,
): Promise<DesignConnectManifest | null> {
  const manifestUrl = new URL("/manifest.json", bridgeUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(manifestUrl, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return isDesignConnectManifest(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function designConnectManifestsTargetSameApp(
  running: Pick<DesignConnectManifest, "devServerUrl" | "rootPath">,
  requested: Pick<DesignConnectManifest, "devServerUrl" | "rootPath">,
): boolean {
  let runningUrl = running.devServerUrl;
  let requestedUrl = requested.devServerUrl;
  try {
    runningUrl = normalizeHttpUrl(runningUrl);
    requestedUrl = normalizeHttpUrl(requestedUrl);
  } catch {
    // Fall through to direct string comparison for malformed legacy manifests.
  }
  return (
    runningUrl === requestedUrl &&
    path.resolve(running.rootPath) === path.resolve(requested.rootPath)
  );
}

async function resolveDevServerUrl(url?: string): Promise<string> {
  if (url) return normalizeHttpUrl(url);
  for (const candidate of DEFAULT_DEV_SERVER_CANDIDATES) {
    if (await probeDevServer(candidate)) return candidate;
  }
  return DEFAULT_DEV_SERVER_CANDIDATES[0]!;
}

async function ensureRouteManifest(options: {
  root: string;
  routeManifestPath: string;
  routes: DesignConnectRoute[];
  devServerUrl: string;
  dryRun: boolean;
}): Promise<{ path: string; created: boolean }> {
  const manifestPath = path.isAbsolute(options.routeManifestPath)
    ? options.routeManifestPath
    : path.join(options.root, options.routeManifestPath);
  if (fsSync.existsSync(manifestPath)) {
    return { path: manifestPath, created: false };
  }
  if (!options.dryRun) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          sourceType: "localhost",
          devServerUrl: options.devServerUrl,
          rootPath: options.root,
          routes: options.routes,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  return { path: manifestPath, created: !options.dryRun };
}

export async function prepareDesignConnectManifest(
  options: Partial<DesignConnectArgs> & { root?: string } = {},
): Promise<DesignConnectManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const devServerUrl = await resolveDevServerUrl(options.url);
  const bridgeUrl = `http://127.0.0.1:${port}`;
  const routes = discoverDesignRoutes(root);
  const routeManifest = await ensureRouteManifest({
    root,
    routeManifestPath: options.routeManifest ?? ROUTE_MANIFEST_FILE,
    routes,
    devServerUrl,
    dryRun: Boolean(options.dryRun),
  });
  const generatedAt = new Date().toISOString();

  return {
    version: 1,
    source: "agent-native-design-connect",
    sourceType: "localhost",
    localOnly: true,
    devServerUrl,
    bridgeUrl,
    rootPath: root,
    routeManifestPath: routeManifest.path,
    routeManifestCreated: routeManifest.created,
    routes,
    routeCount: routes.length,
    generatedAt,
    manifestCapabilities: MANIFEST_CAPABILITIES,
    capabilities: BRIDGE_OPERATIONS.map((operation) => ({
      operation,
      status: "available" as const,
      reason:
        operation === "resolveNodeToFile"
          ? // resolveNodeToFile maps a runtime DOM node id (from the editor's
            // 'select' payload) to { file, line, component } provenance.  The
            // bridge endpoint exists; per-element provenance data must be
            // emitted by the connected app at build time — see the provenance
            // note in the help text below.
            "Requires the connected app to emit data-source-file / data-source-line / data-component-name attributes (e.g. via @vitejs/plugin-react jsxDEV or a Babel source plugin)."
          : undefined,
    })),
  };
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-bridge-token",
    "access-control-allow-private-network": "true",
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-bridge-token",
    "access-control-allow-private-network": "true",
  });
  res.end(body);
}

function sendBytes(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  headers: Headers,
) {
  const responseHeaders: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-bridge-token",
    "access-control-allow-private-network": "true",
  };
  for (const name of [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    const value = headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  res.writeHead(statusCode, responseHeaders);
  res.end(body);
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function resolvePreviewSnapshotUrl(
  devServerUrl: string,
  rawUrl: string | null,
): string {
  const base = normalizeHttpUrl(devServerUrl);
  const parsed = new URL(rawUrl?.trim() || "/", `${base}/`);
  parsed.hash = "";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Snapshot URL must use http(s).");
  }
  if (!sameOrigin(parsed.toString(), base)) {
    throw new Error("Snapshot URL must stay on the connected dev server.");
  }
  return parsed.toString();
}

function resolvePreviewProxyUrl(
  devServerUrl: string,
  requestUrl: string | undefined,
): string {
  const base = normalizeHttpUrl(devServerUrl);
  const parsedRequest = new URL(requestUrl ?? "/", base);
  const parsed = new URL(
    `${parsedRequest.pathname}${parsedRequest.search}`,
    `${base}/`,
  );
  parsed.hash = "";
  if (!sameOrigin(parsed.toString(), base)) {
    throw new Error("Proxy URL must stay on the connected dev server.");
  }
  return parsed.toString();
}

async function fetchPreviewSnapshot(
  devServerUrl: string,
  targetUrl: string,
  redirects = 0,
): Promise<{
  url: string;
  status: number;
  contentType: string;
  html: string;
}> {
  if (redirects > 5) {
    throw new Error("Too many redirects while fetching preview snapshot.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const redirected = new URL(location, targetUrl);
      redirected.hash = "";
      if (!sameOrigin(redirected.toString(), devServerUrl)) {
        throw new Error("Snapshot redirect left the connected dev server.");
      }
      return fetchPreviewSnapshot(
        devServerUrl,
        redirected.toString(),
        redirects + 1,
      );
    }
    return {
      url: response.url || targetUrl,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPreviewProxyResource(
  devServerUrl: string,
  targetUrl: string,
  redirects = 0,
): Promise<{
  url: string;
  status: number;
  headers: Headers;
  body: Buffer;
}> {
  if (redirects > 5) {
    throw new Error("Too many redirects while proxying preview resource.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const redirected = new URL(location, targetUrl);
      redirected.hash = "";
      if (!sameOrigin(redirected.toString(), devServerUrl)) {
        throw new Error("Proxy redirect left the connected dev server.");
      }
      return fetchPreviewProxyResource(
        devServerUrl,
        redirected.toString(),
        redirects + 1,
      );
    }
    return {
      url: response.url || targetUrl,
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function addLiveEditBaseHref(html: string, href: string): string {
  const escapedHref = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const baseTag = `<base href="${escapedHref}">`;
  if (/<base\b/i.test(html)) return html;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${baseTag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}<head>${baseTag}</head>`,
    );
  }
  return `<!DOCTYPE html><html><head>${baseTag}<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
}

function injectLiveEditBridge(html: string, targetUrl: string, script: string) {
  const withBase = addLiveEditBaseHref(html, targetUrl);
  if (!script) return withBase;
  if (withBase.includes("</body>")) {
    return withBase.replace("</body>", `${script}</body>`);
  }
  if (withBase.includes("</html>")) {
    return withBase.replace("</html>", `${script}</html>`);
  }
  return `${withBase}${script}`;
}

/** Read the full request body as a UTF-8 string. */
async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Resolve `targetDir` under `rootPath` with realpath so that symlinks and
 * traversal sequences (../../etc) cannot escape the root.  Throws if the
 * resolved path does not start with the resolved root.
 *
 * This also guards against a symlink LEAF inside root (e.g.
 * `rootPath/link.css` -> `/Users/me/.ssh/id_rsa`): the parent-directory
 * realpath check alone would pass confinement because the parent is inside
 * root, letting reads/writes silently follow the symlink outside root. After
 * the parent check we additionally lstat the target itself — if it exists and
 * is a symlink, or if its realpath resolves outside `resolvedRoot`, we reject.
 */
async function assertPathInside(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = await fs.realpath(rootPath).catch(() => {
    throw new Error(`Bridge root path does not exist: ${rootPath}`);
  });

  // Resolve the parent directory (the file itself may not exist yet for writes).
  const targetParent = path.dirname(path.resolve(rootPath, targetPath));
  const resolvedParent = await fs.realpath(targetParent).catch(async () => {
    // Parent may not exist yet; walk up until we find a real ancestor.
    let candidate = targetParent;
    for (let i = 0; i < 32; i++) {
      const up = path.dirname(candidate);
      if (up === candidate) break;
      candidate = up;
      try {
        return await fs.realpath(candidate);
      } catch {
        // keep walking
      }
    }
    throw new Error(`Cannot resolve parent directory: ${targetParent}`);
  });

  if (
    !resolvedParent.startsWith(resolvedRoot + path.sep) &&
    resolvedParent !== resolvedRoot
  ) {
    throw new Error(`Path traversal detected: resolved target is outside root`);
  }

  // Reject a symlink LEAF, even though its parent directory is confined to
  // root. A pre-existing symlink at the target path (file or directory) could
  // otherwise be followed straight out of root by the caller's subsequent
  // fs.readFile/fs.writeFile call.
  const targetAbsolute = path.resolve(rootPath, targetPath);
  const lstat = await fs.lstat(targetAbsolute).catch(() => null);
  if (lstat?.isSymbolicLink()) {
    throw new Error(
      `Path traversal detected: "${targetPath}" is a symlink, which is not allowed inside the connected root`,
    );
  }
  if (lstat) {
    const resolvedTarget = await fs.realpath(targetAbsolute).catch(() => null);
    if (
      resolvedTarget &&
      resolvedTarget !== resolvedRoot &&
      !resolvedTarget.startsWith(resolvedRoot + path.sep)
    ) {
      throw new Error(
        `Path traversal detected: "${targetPath}" resolves outside the connected root`,
      );
    }
  }
}

/** Allowed file extensions for write/apply-edit operations. */
const ALLOWED_WRITE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".vue",
  ".svelte",
  ".astro",
  ".txt",
  ".yml",
  ".yaml",
  ".svg",
]);

function assertAllowedExtension(relPath: string): void {
  const ext = path.extname(relPath).toLowerCase();
  if (!ALLOWED_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Write rejected: extension "${ext || "(no extension)"}" is not in the allowed text-file list for bridge writes.`,
    );
  }
}

/**
 * Blocklist for secret-looking paths. Applied to /read-file, /write-file,
 * /apply-edit, AND /list-files so secrets are never returned or served
 * through the bridge, even to a caller holding a valid write grant. Reads of
 * other dotfiles (.gitignore, .prettierrc, etc.) remain allowed.
 *
 * All comparisons are case-insensitive: macOS's default filesystem (and
 * Windows) is case-insensitive, so ".ENV", "ID_RSA", or "KEY.PEM" refer to
 * the exact same on-disk file as their lowercase form and must be blocked
 * identically.
 */
function isBlockedSecretPath(relPath: string): boolean {
  const normalized = normalizeSlash(relPath).replace(/^\/+/, "").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".git")) return true;
  const basename = segments[segments.length - 1] ?? normalized;
  if (/^\.env/.test(basename)) return true;
  if (/\.pem$/.test(basename)) return true;
  if (/\.key$/.test(basename)) return true;
  if (/^id_rsa/.test(basename)) return true;
  return false;
}

function assertNotBlockedSecretPath(relPath: string): void {
  if (isBlockedSecretPath(relPath)) {
    throw new Error(
      `Access rejected: "${relPath}" matches a blocked secret-file pattern.`,
    );
  }
}

/**
 * Compute a cheap, stable version identifier for a file from its stat: mtime
 * plus size. Not a content hash — it is only meant to detect "did this file
 * change on disk since the caller last read it", the same tradeoff the inline
 * (SQL-backed) workspace provider's versionHash already makes. Returns
 * undefined when the file does not exist (new-file case).
 */
async function computeVersionHash(
  absolutePath: string,
): Promise<string | undefined> {
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat) return undefined;
  return `${stat.mtimeMs}-${stat.size}`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    if (count > 1) return count;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

// ── /list-files: recursive walk with .gitignore + always-ignore + size/binary
// filtering ───────────────────────────────────────────────────────────────

/** Directories always excluded from /list-files, regardless of .gitignore. */
const ALWAYS_IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".output",
  ".nuxt",
  "coverage",
  ".cache",
]);

const ALWAYS_IGNORED_FILE_NAMES = new Set([".DS_Store"]);

/** Binary-looking extensions skipped from /list-files results. */
const BINARY_LOOKING_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".webm",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".wasm",
  ".fig",
  ".sketch",
]);

const LIST_FILES_MAX_ENTRIES = 20_000;
const LIST_FILES_MAX_BYTES = 2 * 1024 * 1024;

export interface GitignoreRule {
  /** Raw pattern as read from .gitignore, already trimmed of comments/blank lines. */
  pattern: string;
  /** True when the pattern is anchored to the root (leading "/"). */
  anchored: boolean;
  /** True when the pattern only matches directories (trailing "/"). */
  dirOnly: boolean;
}

/**
 * Parse a simple subset of .gitignore syntax: exact names, `dir/`, `*.ext`,
 * and leading-slash root-anchored patterns. This intentionally does not
 * implement full gitignore glob semantics (double-star, negation, etc.) —
 * good enough to keep obviously-ignored build output and local files out of
 * the workbench file tree.
 */
export function parseGitignore(contents: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) continue; // negation unsupported in this subset
    const anchored = line.startsWith("/");
    const withoutAnchor = anchored ? line.slice(1) : line;
    const dirOnly = withoutAnchor.endsWith("/");
    const pattern = dirOnly ? withoutAnchor.slice(0, -1) : withoutAnchor;
    if (!pattern) continue;
    rules.push({ pattern, anchored, dirOnly });
  }
  return rules;
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (const char of pattern) {
    if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * Test one path segment (or full relative path, for anchored patterns)
 * against a parsed gitignore rule.
 */
function ruleMatches(
  rule: GitignoreRule,
  relPath: string,
  isDir: boolean,
): boolean {
  if (rule.dirOnly && !isDir) return false;
  const regex = globToRegExp(rule.pattern);
  if (rule.anchored) {
    return regex.test(relPath);
  }
  // Unanchored: match against any path segment (basename) or the full path,
  // mirroring gitignore's "matches at any depth" behavior for simple patterns.
  const segments = relPath.split("/");
  return segments.some((segment) => regex.test(segment)) || regex.test(relPath);
}

export function isIgnoredByGitignore(
  rules: GitignoreRule[],
  relPath: string,
  isDir: boolean,
): boolean {
  return rules.some((rule) => ruleMatches(rule, relPath, isDir));
}

/**
 * Pure predicate: should this file be excluded from /list-files results?
 * Combines the always-ignored directory/file names, the parsed .gitignore
 * rules, the binary-looking extension list, the secret-path blocklist, and
 * the per-file size cap. `sizeBytes` may be omitted when unknown (the always/
 * gitignore/binary/secret checks still apply).
 */
export function shouldExcludeFromListing(
  relPath: string,
  options: { gitignore: GitignoreRule[]; sizeBytes?: number },
): boolean {
  const normalized = normalizeSlash(relPath).replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => ALWAYS_IGNORED_DIR_NAMES.has(segment))) {
    return true;
  }
  const basename = segments[segments.length - 1] ?? normalized;
  if (ALWAYS_IGNORED_FILE_NAMES.has(basename)) return true;
  if (isBlockedSecretPath(normalized)) return true;
  if (isIgnoredByGitignore(options.gitignore, normalized, false)) return true;
  // A `dir/` gitignore rule matches the file's ancestor directories too, not
  // just the file itself (e.g. "build-output/" must ignore
  // "build-output/index.html").
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestorPath = segments.slice(0, depth).join("/");
    if (isIgnoredByGitignore(options.gitignore, ancestorPath, true)) {
      return true;
    }
  }
  const ext = path.extname(basename).toLowerCase();
  if (BINARY_LOOKING_EXTENSIONS.has(ext)) return true;
  if (
    typeof options.sizeBytes === "number" &&
    options.sizeBytes > LIST_FILES_MAX_BYTES
  ) {
    return true;
  }
  return false;
}

/**
 * Should this directory be pruned entirely from the walk? Cheaper than
 * checking every descendant file individually once a directory itself is
 * ignored (always-ignored names, gitignore dir rules, or the .git/secret
 * blocklist).
 */
function shouldPruneDirectory(
  relPath: string,
  gitignore: GitignoreRule[],
): boolean {
  const normalized = normalizeSlash(relPath).replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? normalized;
  if (ALWAYS_IGNORED_DIR_NAMES.has(basename)) return true;
  if (basename === ".git") return true;
  if (isIgnoredByGitignore(gitignore, normalized, true)) return true;
  return false;
}

export interface ListedBridgeFile {
  path: string;
  size: number;
}

export interface ListFilesResult {
  files: ListedBridgeFile[];
  truncated: boolean;
}

/**
 * Recursively walk `rootPath`, honoring .gitignore + the always-ignore list +
 * binary/size/secret filtering, never following symlinks that would escape
 * root (delegates to `assertPathInside`'s realpath confinement per-entry).
 * Caps at `LIST_FILES_MAX_ENTRIES` and reports `truncated` when the cap is
 * hit.
 */
async function walkBridgeFiles(rootPath: string): Promise<ListFilesResult> {
  let gitignore: GitignoreRule[] = [];
  try {
    const raw = await fs.readFile(path.join(rootPath, ".gitignore"), "utf8");
    gitignore = parseGitignore(raw);
  } catch {
    // No root .gitignore — proceed with only the always-ignore list.
  }

  const files: ListedBridgeFile[] = [];
  let truncated = false;
  const resolvedRoot = await fs.realpath(rootPath);

  async function walk(absoluteDir: string, relDir: string): Promise<void> {
    if (truncated) return;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort for deterministic output.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);

      if (entry.isSymbolicLink()) {
        // Never follow symlinks that escape root; resolve and re-check.
        let real: string;
        try {
          real = await fs.realpath(absolutePath);
        } catch {
          continue;
        }
        if (
          real !== resolvedRoot &&
          !real.startsWith(resolvedRoot + path.sep)
        ) {
          continue;
        }
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat) continue;
        if (stat.isDirectory()) {
          if (shouldPruneDirectory(relPath, gitignore)) continue;
          await walk(absolutePath, relPath);
        } else if (stat.isFile()) {
          if (
            !shouldExcludeFromListing(relPath, {
              gitignore,
              sizeBytes: stat.size,
            })
          ) {
            files.push({ path: normalizeSlash(relPath), size: stat.size });
            if (files.length >= LIST_FILES_MAX_ENTRIES) {
              truncated = true;
              return;
            }
          }
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (shouldPruneDirectory(relPath, gitignore)) continue;
        await walk(absolutePath, relPath);
        continue;
      }

      if (entry.isFile()) {
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat) continue;
        if (
          shouldExcludeFromListing(relPath, {
            gitignore,
            sizeBytes: stat.size,
          })
        ) {
          continue;
        }
        files.push({ path: normalizeSlash(relPath), size: stat.size });
        if (files.length >= LIST_FILES_MAX_ENTRIES) {
          truncated = true;
          return;
        }
      }
    }
  }

  await walk(resolvedRoot, "");
  return { files, truncated };
}

export async function startDesignConnectBridge(
  manifest: DesignConnectManifest,
): Promise<DesignConnectBridge> {
  // Mint a cryptographically random per-rootPath bridge token.  This token is
  // kept in-process only and is never emitted via the public GET routes so that
  // an unauthenticated caller cannot read it.  The server-side grant action
  // obtains it out-of-band (via the exported bridge reference).
  const bridgeToken = crypto.randomBytes(32).toString("hex");
  let liveEditBridgeScript = "";

  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      const pathname = new URL(req.url ?? "/", manifest.bridgeUrl).pathname;

      // ── Public read-only routes (no token required) ──────────────────────

      if (pathname === "/" || pathname === "/manifest.json") {
        sendJson(res, 200, manifest as unknown as Record<string, unknown>);
        return;
      }
      if (pathname === "/routes.json") {
        sendJson(res, 200, {
          version: 1,
          sourceType: "localhost",
          devServerUrl: manifest.devServerUrl,
          rootPath: manifest.rootPath,
          routes: manifest.routes,
          generatedAt: manifest.generatedAt,
        });
        return;
      }
      if (pathname === "/health") {
        sendJson(res, 200, { ok: true, source: manifest.source });
        return;
      }
      if (pathname === "/live-edit-bridge") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const tokenHeader = req.headers["x-bridge-token"];
        const providedToken =
          typeof tokenHeader === "string" ? tokenHeader : "";
        let tokenValid = false;
        try {
          tokenValid =
            providedToken.length === bridgeToken.length &&
            crypto.timingSafeEqual(
              Buffer.from(providedToken, "utf8"),
              Buffer.from(bridgeToken, "utf8"),
            );
        } catch {
          tokenValid = false;
        }
        if (!tokenValid) {
          sendJson(res, 401, {
            ok: false,
            error: "invalid or missing bridge token",
          });
          return;
        }
        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as Record<string, unknown>;
            const script =
              typeof body["script"] === "string" ? body["script"] : "";
            if (!script.includes("agent-native:editor-chrome-ready")) {
              sendJson(res, 400, {
                ok: false,
                error: "script must install the Agent Native editor bridge",
              });
              return;
            }
            liveEditBridgeScript = script;
            sendJson(res, 200, { ok: true });
          } catch (err: unknown) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }
      if (pathname === "/live-edit") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        void (async () => {
          try {
            const requestUrl = new URL(req.url ?? "/", manifest.bridgeUrl);
            const targetUrl = resolvePreviewSnapshotUrl(
              manifest.devServerUrl,
              requestUrl.searchParams.get("url") ??
                requestUrl.searchParams.get("path"),
            );
            const snapshot = await fetchPreviewSnapshot(
              manifest.devServerUrl,
              targetUrl,
            );
            const includeEditorBridge =
              requestUrl.searchParams.get("bridge") !== "0";
            const html = injectLiveEditBridge(
              snapshot.html,
              new URL("/", manifest.bridgeUrl).toString(),
              includeEditorBridge ? liveEditBridgeScript : "",
            );
            sendText(
              res,
              snapshot.status >= 400 ? snapshot.status : 200,
              html,
              snapshot.contentType.includes("html")
                ? snapshot.contentType
                : "text/html; charset=utf-8",
            );
          } catch (err: unknown) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }
      if (pathname === "/snapshot") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        void (async () => {
          try {
            const requestUrl = new URL(req.url ?? "/", manifest.bridgeUrl);
            const targetUrl = resolvePreviewSnapshotUrl(
              manifest.devServerUrl,
              requestUrl.searchParams.get("url") ??
                requestUrl.searchParams.get("path"),
            );
            const snapshot = await fetchPreviewSnapshot(
              manifest.devServerUrl,
              targetUrl,
            );
            sendJson(res, snapshot.status >= 400 ? snapshot.status : 200, {
              ok: snapshot.status < 400,
              source: manifest.source,
              url: snapshot.url,
              status: snapshot.status,
              contentType: snapshot.contentType,
              html: snapshot.html,
            });
          } catch (err: unknown) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }

      // ── Token-gated write endpoints (POST only) ───────────────────────────

      if (
        pathname === "/read-file" ||
        pathname === "/write-file" ||
        pathname === "/apply-edit" ||
        pathname === "/list-files"
      ) {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }

        // Authenticate with constant-time comparison to prevent timing attacks.
        const tokenHeader = req.headers["x-bridge-token"];
        const providedToken =
          typeof tokenHeader === "string" ? tokenHeader : "";
        let tokenValid = false;
        try {
          tokenValid =
            providedToken.length === bridgeToken.length &&
            crypto.timingSafeEqual(
              Buffer.from(providedToken, "utf8"),
              Buffer.from(bridgeToken, "utf8"),
            );
        } catch {
          tokenValid = false;
        }
        if (!tokenValid) {
          sendJson(res, 401, {
            ok: false,
            error: "invalid or missing bridge token",
          });
          return;
        }

        // Handle asynchronously so we can use await.
        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as Record<string, unknown>;

            if (pathname === "/list-files") {
              try {
                const result = await walkBridgeFiles(manifest.rootPath);
                sendJson(res, 200, {
                  ok: true,
                  files: result.files,
                  truncated: result.truncated,
                });
              } catch (err: unknown) {
                sendJson(res, 500, {
                  ok: false,
                  error: `list-files failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
              return;
            }

            const relPath =
              typeof body["relPath"] === "string" ? body["relPath"] : undefined;

            if (!relPath) {
              sendJson(res, 400, { ok: false, error: "relPath is required" });
              return;
            }

            await assertPathInside(manifest.rootPath, relPath);
            assertNotBlockedSecretPath(relPath);
            const absolutePath = path.resolve(manifest.rootPath, relPath);

            if (pathname === "/read-file") {
              // Read-file: no extension restriction (agents need to read any
              // non-secret file), but the secret-path blocklist above still
              // applies to .env*, *.pem, *.key, id_rsa*, and anything under .git/.
              let content: string;
              try {
                content = await fs.readFile(absolutePath, "utf8");
              } catch (err: unknown) {
                const code =
                  err instanceof Error &&
                  "code" in err &&
                  (err as NodeJS.ErrnoException).code;
                if (code === "ENOENT") {
                  sendJson(res, 404, { ok: false, error: "file not found" });
                } else {
                  sendJson(res, 500, {
                    ok: false,
                    error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
                  });
                }
                return;
              }
              const versionHash = await computeVersionHash(absolutePath);
              sendJson(res, 200, { ok: true, content, versionHash });
              return;
            }

            // write-file and apply-edit only allow known text/code extensions.
            assertAllowedExtension(relPath);

            // Optional optimistic-concurrency check: when the caller supplies
            // expectedVersionHash, compare it against the file's CURRENT hash
            // before writing. A missing file is treated as no-conflict (new
            // file case) so first-time writes always succeed.
            const expectedVersionHash =
              typeof body["expectedVersionHash"] === "string"
                ? body["expectedVersionHash"]
                : undefined;
            if (expectedVersionHash !== undefined) {
              const currentVersionHash = await computeVersionHash(absolutePath);
              if (
                currentVersionHash !== undefined &&
                currentVersionHash !== expectedVersionHash
              ) {
                sendJson(res, 409, {
                  ok: false,
                  error: "version conflict",
                  currentVersionHash,
                });
                return;
              }
            }

            if (pathname === "/write-file") {
              const content =
                typeof body["content"] === "string"
                  ? body["content"]
                  : undefined;
              if (content === undefined) {
                sendJson(res, 400, {
                  ok: false,
                  error: "content is required for write-file",
                });
                return;
              }
              await fs.mkdir(path.dirname(absolutePath), { recursive: true });
              await fs.writeFile(absolutePath, content, "utf8");
              const versionHash = await computeVersionHash(absolutePath);
              sendJson(res, 200, { ok: true, relPath, versionHash });
              return;
            }

            // /apply-edit: supports either full replace ({content}) or
            // search-and-replace ({search, replace}).
            if (typeof body["content"] === "string") {
              // Full-file replace via apply-edit — same as write-file but keeps
              // the endpoint semantically separate for callers that want to
              // distinguish intent.
              await fs.mkdir(path.dirname(absolutePath), { recursive: true });
              await fs.writeFile(
                absolutePath,
                body["content"] as string,
                "utf8",
              );
              const versionHash = await computeVersionHash(absolutePath);
              sendJson(res, 200, {
                ok: true,
                relPath,
                method: "replace",
                versionHash,
              });
              return;
            }

            const search =
              typeof body["search"] === "string" ? body["search"] : undefined;
            const replace =
              typeof body["replace"] === "string" ? body["replace"] : undefined;
            if (search === undefined || replace === undefined) {
              sendJson(res, 400, {
                ok: false,
                error:
                  "apply-edit requires either {content} for a full replace, or {search, replace} for a patch",
              });
              return;
            }

            let existing: string;
            try {
              existing = await fs.readFile(absolutePath, "utf8");
            } catch (err: unknown) {
              const code =
                err instanceof Error &&
                "code" in err &&
                (err as NodeJS.ErrnoException).code;
              if (code === "ENOENT") {
                sendJson(res, 404, {
                  ok: false,
                  error: "file not found — use write-file to create new files",
                });
              } else {
                sendJson(res, 500, {
                  ok: false,
                  error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
              return;
            }

            if (search.length === 0) {
              sendJson(res, 400, {
                ok: false,
                error: "search string must not be empty",
              });
              return;
            }

            const occurrenceCount = countOccurrences(existing, search);
            if (occurrenceCount === 0) {
              sendJson(res, 422, {
                ok: false,
                error: "search string not found in file",
              });
              return;
            }
            if (occurrenceCount > 1) {
              sendJson(res, 422, {
                ok: false,
                error:
                  "search string is ambiguous; it appears more than once in the file",
              });
              return;
            }

            const updated = existing.replace(search, replace);
            await fs.writeFile(absolutePath, updated, "utf8");
            const versionHash = await computeVersionHash(absolutePath);
            sendJson(res, 200, {
              ok: true,
              relPath,
              method: "patch",
              versionHash,
            });
          } catch (err: unknown) {
            sendJson(res, 500, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        void (async () => {
          try {
            const targetUrl = resolvePreviewProxyUrl(
              manifest.devServerUrl,
              req.url,
            );
            const proxied = await fetchPreviewProxyResource(
              manifest.devServerUrl,
              targetUrl,
            );
            sendBytes(
              res,
              proxied.status >= 400 ? proxied.status : 200,
              req.method === "HEAD" ? Buffer.alloc(0) : proxied.body,
              proxied.headers,
            );
          } catch (err: unknown) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(new URL(manifest.bridgeUrl).port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return { server, manifest, bridgeToken };
}

/**
 * Resolve the design app URL from an explicit value or environment variables.
 * Returns undefined when no URL is configured (registration is optional).
 */
export function resolveAppUrl(explicit?: string): string | undefined {
  const raw =
    explicit ||
    process.env["AGENT_NATIVE_URL"] ||
    process.env["DESIGN_APP_URL"] ||
    process.env["APP_URL"] ||
    process.env["VITE_APP_URL"] ||
    process.env["BETTER_AUTH_URL"] ||
    process.env["VITE_BETTER_AUTH_URL"];
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Resolve a bearer token from environment variables for authenticating the
 * self-registration POST.  The CLI does not perform a device-code flow — it
 * relies on a pre-minted token supplied via env var (e.g. the same token
 * already written into the agent's MCP config).
 */
function resolveAuthToken(): string | undefined {
  return (
    process.env["AGENT_NATIVE_TOKEN"] ||
    process.env["DESIGN_ACCESS_TOKEN"] ||
    process.env["ACCESS_TOKEN"] ||
    undefined
  );
}

/**
 * POST to the design app's `connect-localhost` action endpoint to register
 * (or refresh) the bridge connection and persist the real bridge token on the
 * server row.  This is a best-effort call: failures are logged but do not
 * abort the bridge process.
 *
 * @param appUrl - Deployed design app base URL (e.g. https://design.agent-native.com)
 * @param bridge - The running bridge returned by startDesignConnectBridge
 * @param authToken - Optional bearer token for the authenticated action route
 */
export async function registerConnectionWithServer(
  appUrl: string,
  bridge: DesignConnectBridge,
  authToken?: string,
): Promise<void> {
  const endpoint = `${appUrl}/_agent-native/actions/connect-localhost`;
  const { manifest, bridgeToken } = bridge;
  const payload = {
    devServerUrl: manifest.devServerUrl,
    bridgeUrl: manifest.bridgeUrl,
    rootPath: manifest.rootPath,
    capabilities: manifest.capabilities.filter((capability) =>
      SERVER_REGISTRATION_BRIDGE_OPERATIONS.has(capability.operation),
    ),
    routeManifest: {
      version: 1 as const,
      sourceType: "localhost" as const,
      devServerUrl: manifest.devServerUrl,
      rootPath: manifest.rootPath,
      routes: manifest.routes,
      generatedAt: manifest.generatedAt,
    },
    // Include the real bridge token so the server stores it on the connection
    // row.  grant-localhost-write-consent then reads it from the row instead of
    // minting its own unrelated token, which would always produce a 401.
    bridgeToken,
    status: "connected" as const,
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authToken) {
    headers["authorization"] = `Bearer ${authToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const message = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status} ${message || res.statusText}`);
    }
  } catch (error) {
    // Best-effort: network errors or auth issues are non-fatal, but make the
    // problem discoverable before the user tries "Apply to source".
    console.error(
      `[design connect] Could not register bridge with ${endpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function printHelp() {
  console.log(`Usage:
  agent-native design connect [options]

Options:
  --url <url>             Dev server URL to inspect (auto-detected if omitted)
  --port <number>         Local bridge port (default ${DEFAULT_BRIDGE_PORT})
  --root <path>           App/repo root for route discovery (default cwd)
  --route-manifest <path> Non-destructive route manifest output path
  --app-url <url>         Deployed design app URL for self-registration
                          (also reads AGENT_NATIVE_URL / DESIGN_APP_URL env)
  --daemon                Start the bridge detached, wait for /health, then exit
  --json                  Print the manifest JSON and exit
  --once                  Prepare/scaffold the manifest and exit
  --dry-run               Print what would be exposed without writing files

Element provenance (resolveNodeToFile):
  The design editor can map a selected DOM element back to its source file,
  line, and React component name when the connected app emits provenance
  attributes at build time.  Add one of the following to your app's build:

  • @vitejs/plugin-react with jsxDEV enabled (development mode default):
      Sets data-source-file and data-source-line on each JSX element
      automatically when using the Babel transform.

  • A Babel source plugin (e.g. babel-plugin-react-source or a custom plugin):
      Emits data-source-file="src/Button.tsx" data-source-line="12"
      data-source-column="4" data-component-name="Button" on each element.

  • data-loc="src/Button.tsx:12:4" shorthand attribute (Babel source convention):
      The bridge parses this as { sourceFile, line, column } automatically.

  Without these attributes the editor still works; provenance is simply absent.
  Cross-origin localhost iframes cannot be read regardless of attributes (CSP).`);
}

function removeDaemonFlag(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--daemon");
}

function resolveCurrentCliInvocation(argv: string[]): {
  command: string;
  args: string[];
} {
  const suffixLength = argv.length + 1; // leading "design" command + runDesign argv
  const prefixEnd = Math.max(1, process.argv.length - suffixLength);
  const cliPrefix = process.argv.slice(1, prefixEnd);
  const entry = cliPrefix[0] ?? process.argv[1];
  if (!entry) {
    throw new Error("Could not resolve current CLI entrypoint for --daemon");
  }
  if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
    return {
      command: "tsx",
      args: [...cliPrefix, "design", ...removeDaemonFlag(argv)],
    };
  }
  return {
    command: process.execPath,
    args: [...cliPrefix, "design", ...removeDaemonFlag(argv)],
  };
}

async function startDetachedDesignBridge(
  argv: string[],
  manifest: DesignConnectManifest,
): Promise<number> {
  if (await waitForBridgeHealth(manifest.bridgeUrl, 800)) {
    const runningManifest = await fetchRunningBridgeManifest(
      manifest.bridgeUrl,
    );
    if (
      runningManifest &&
      designConnectManifestsTargetSameApp(runningManifest, manifest)
    ) {
      console.error(
        `Design localhost bridge already running at ${manifest.bridgeUrl}`,
      );
      console.log(JSON.stringify(runningManifest, null, 2));
      return 0;
    }

    console.error(
      [
        `Design localhost bridge already running at ${manifest.bridgeUrl} for a different app.`,
        runningManifest
          ? `Running app: ${runningManifest.devServerUrl} (${runningManifest.rootPath})`
          : "Running bridge did not expose a compatible manifest.",
        `Requested app: ${manifest.devServerUrl} (${manifest.rootPath})`,
        "Stop the existing bridge or choose a different --port.",
      ].join("\n"),
    );
    return 1;
  }

  const invocation = resolveCurrentCliInvocation(argv);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.unref();

  if (await waitForBridgeHealth(manifest.bridgeUrl)) {
    console.error(`Design localhost bridge running at ${manifest.bridgeUrl}`);
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }

  console.error(
    `Timed out waiting for detached Design bridge at ${manifest.bridgeUrl}`,
  );
  return 1;
}

export async function runDesign(argv: string[]) {
  const subcommand = argv[0];
  if (subcommand !== "connect") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printHelp();
      return 0;
    }
    console.error("Usage: agent-native design connect [options]");
    return 1;
  }

  const parsed = parseDesignConnectArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }

  const manifest = await prepareDesignConnectManifest(parsed);
  if (parsed.daemon) {
    return startDetachedDesignBridge(argv, manifest);
  }
  if (parsed.json || parsed.once || parsed.dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }

  const bridge = await startDesignConnectBridge(manifest);
  console.error("Design localhost bridge running");
  console.error(`Bridge:   ${manifest.bridgeUrl}`);
  console.error(`Manifest: ${manifest.bridgeUrl}/manifest.json`);
  console.error(`Routes:   ${manifest.routeCount}`);
  console.error(`Dev URL:  ${manifest.devServerUrl}`);

  // Self-register with the design app server (best-effort).  When an app URL
  // is available (via --app-url or env var) the CLI POSTs the bridge token to
  // connect-localhost so the server row stores the real token.  Without this
  // step grant-localhost-write-consent would mint a different token, causing
  // every bridge write to return 401.
  const appUrl = resolveAppUrl(parsed.appUrl);
  if (appUrl) {
    const authToken = resolveAuthToken();
    void registerConnectionWithServer(appUrl, bridge, authToken);
  }

  return await new Promise<number>((resolve) => {
    const stop = () => {
      bridge.server.close(() => resolve(0));
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.once(signal, stop);
    }
  });
}
