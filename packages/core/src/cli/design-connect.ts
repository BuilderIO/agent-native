import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import path from "node:path";

import { injectDocumentMarkup } from "../shared/html-document.js";

const DEFAULT_BRIDGE_PORT = 7331;
const ROUTE_MANIFEST_FILE = path.join(".agent-native", "design-routes.json");
const BRIDGE_TOKEN_FILE = path.join(".agent-native", "design-bridge-token");
const LIVE_EDIT_REVISION_FILE = path.join(
  ".agent-native",
  "live-edit-revisions.json",
);
const LOCALHOST_CONNECTION_ID = /^localhost_[A-Za-z0-9_-]{16}$/;
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
  appUrl?: string;
  /** Server-minted bridge token to adopt instead of minting one, so the bridge
   *  matches the token already stored on the user's connection row (no
   *  self-registration). Also read from AGENT_NATIVE_BRIDGE_TOKEN. */
  bridgeToken?: string;
  /** Read-only token used by Design browser previews. This is deliberately
   *  distinct from `bridgeToken`, which unlocks local filesystem reads/writes.
   *  When omitted it is derived one-way from bridgeToken for compatibility
   *  with existing /visual-edit launch commands. */
  previewToken?: string;
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
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
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
  manifestCapabilities: typeof MANIFEST_CAPABILITIES;
}

export interface DesignConnectBridge {
  server: Server;
  manifest: DesignConnectManifest;
  /** Per-rootPath bridge token. Kept in-process only; never serialised into
   *  the manifest JSON so it is not exposed over the network via GET /manifest.
   *  The server-side grant action reads it from the running bridge instance. */
  bridgeToken: string;
  /** Read-only token accepted by manifest, route, snapshot, proxy, and editor
   *  bridge-registration endpoints. Safe to hand to the Design browser, but
   *  never accepted by filesystem endpoints. */
  previewToken: string;
  bridgeInstanceId: string;
}

export interface DesignConnectBridgeOptions {
  bridgeToken?: string;
  previewToken?: string;
  persistBridgeToken?: boolean;
  allowedOrigins?: string[];
}

async function readPersistedBridgeToken(
  rootPath: string,
): Promise<string | undefined> {
  try {
    const token = (
      await fs.readFile(path.join(rootPath, BRIDGE_TOKEN_FILE), "utf8")
    ).trim();
    return token || undefined;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function persistBridgeToken(
  rootPath: string,
  token: string,
): Promise<void> {
  const absolutePath = path.join(rootPath, BRIDGE_TOKEN_FILE);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(temporaryPath, 0o600);
  await fs.rename(temporaryPath, absolutePath);
}

async function resolveBridgeToken(
  rootPath: string,
  configuredToken?: string,
  persist = true,
): Promise<string> {
  const persistedToken = await readPersistedBridgeToken(rootPath);
  const bridgeToken =
    configuredToken ||
    process.env["AGENT_NATIVE_BRIDGE_TOKEN"] ||
    persistedToken ||
    crypto.randomBytes(32).toString("hex");

  if (LOCALHOST_CONNECTION_ID.test(bridgeToken)) {
    throw new Error(
      "AGENT_NATIVE_BRIDGE_TOKEN is a localhost connection ID, not a bridge token. " +
        "Start visual-edit with the bridgeToken returned by open-visual-edit, then restart the bridge.",
    );
  }

  // bridge accepted this token. A rejected token must not replace recovery data.
  if (persist && (configuredToken || !persistedToken)) {
    await persistBridgeToken(rootPath, bridgeToken);
  }
  return bridgeToken;
}

const PREVIEW_TOKEN_DOMAIN = "agent-native-design-preview-v1\0";
const LIVE_EDIT_CAPABILITY_DOMAIN = "agent-native-live-edit-design-v1\0";
const LIVE_EDIT_REGISTRATION_CAPABILITY_DOMAIN =
  "agent-native-live-edit-registration-v1\0";
const PREVIEW_ATTESTATION_DOMAIN =
  "agent-native-design-preview-attestation-v1\0";
const PREVIEW_SESSION_COOKIE_NAME = "agent-native-preview-token";
const BRIDGE_FRAME_HEADERS = {
  "cross-origin-embedder-policy": "credentialless",
  "cross-origin-resource-policy": "cross-origin",
} as const;

/**
 * Derive a read-only preview credential from the stronger filesystem token.
 * The one-way hash keeps old `--bridge-token` launch commands compatible while
 * ensuring a leaked preview credential cannot be promoted into write access.
 */
export function deriveDesignPreviewToken(bridgeToken: string): string {
  return crypto
    .createHash("sha256")
    .update(PREVIEW_TOKEN_DOMAIN)
    .update(bridgeToken)
    .digest("hex");
}

export function deriveDesignScopedLiveEditCapability(
  bridgeToken: string,
  designId: string,
): string {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(LIVE_EDIT_CAPABILITY_DOMAIN)
    .update(designId)
    .digest("hex");
}

export function deriveDesignScopedLiveEditRegistrationCapability(
  bridgeToken: string,
  designId: string,
): string {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(LIVE_EDIT_REGISTRATION_CAPABILITY_DOMAIN)
    .update(designId)
    .digest("hex");
}

export function deriveDesignPreviewAttestationSignature(
  bridgeToken: string,
  challenge: string,
): string {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(PREVIEW_ATTESTATION_DOMAIN)
    .update(challenge)
    .digest("hex");
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
    } else if (arg === "--bridge-token") {
      parsed.bridgeToken = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--bridge-token=")) {
      parsed.bridgeToken = arg.slice("--bridge-token=".length);
    } else if (arg === "--preview-token") {
      parsed.previewToken = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--preview-token=")) {
      parsed.previewToken = arg.slice("--preview-token=".length);
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
  const normalized = routePath.trim() || "/";
  const slug = normalized
    .replace(/^\/+/, "")
    .replace(/\*/g, "w")
    .replace(/:/g, "p")
    .replace(/[[\]]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const readable =
    normalized === "/"
      ? "root"
      : /^\/\*+$/.test(normalized) || !slug
        ? "wildcard"
        : slug;
  return `route-${readable}-${stableRoutePathHash(normalized)}`;
}

function stableRoutePathHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
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
  previewToken: string,
): Promise<{
  manifest: DesignConnectManifest | null;
  status: number | null;
}> {
  const manifestUrl = new URL("/manifest.json", bridgeUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(manifestUrl, {
      method: "GET",
      headers: { "x-design-preview-token": previewToken },
      signal: controller.signal,
    });
    if (!response.ok) return { manifest: null, status: response.status };
    const body = (await response.json()) as unknown;
    return {
      manifest: isDesignConnectManifest(body) ? body : null,
      status: response.status,
    };
  } catch {
    return { manifest: null, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectRunningBridge(
  manifest: DesignConnectManifest,
  bridgeToken: string,
) {
  const [manifestResult, runningFingerprint] = await Promise.all([
    fetchRunningBridgeManifest(
      manifest.bridgeUrl,
      deriveDesignPreviewToken(bridgeToken),
    ),
    fetchRunningBridgeFingerprint(manifest.bridgeUrl),
  ]);
  return {
    ...manifestResult,
    fingerprintMatches:
      runningFingerprint === designConnectAppFingerprint(manifest),
  };
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

export function designConnectAppFingerprint(
  manifest: Pick<DesignConnectManifest, "devServerUrl" | "rootPath">,
): string {
  let devServerUrl = manifest.devServerUrl;
  try {
    devServerUrl = normalizeHttpUrl(devServerUrl);
  } catch {
    // Hash the original string for malformed legacy manifests.
  }
  return crypto
    .createHash("sha256")
    .update(`${devServerUrl}\n${path.resolve(manifest.rootPath)}`)
    .digest("base64url")
    .slice(0, 24);
}

async function fetchRunningBridgeFingerprint(
  bridgeUrl: string,
): Promise<string | null> {
  const healthUrl = new URL("/health", bridgeUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body["appFingerprint"] === "string"
      ? body["appFingerprint"]
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
}): Promise<{ path: string; created: boolean; routes: DesignConnectRoute[] }> {
  const manifestPath = path.isAbsolute(options.routeManifestPath)
    ? options.routeManifestPath
    : path.join(options.root, options.routeManifestPath);
  if (fsSync.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(
        await fs.readFile(manifestPath, "utf8"),
      ) as Record<string, unknown>;
      const savedRoutes = Array.isArray(parsed.routes)
        ? parsed.routes.flatMap((value): DesignConnectRoute[] => {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
              return [];
            }
            const route = value as Record<string, unknown>;
            if (typeof route.path !== "string" || !route.path.trim()) return [];
            const sourceKind =
              route.sourceKind === "react-router" ||
              route.sourceKind === "html" ||
              route.sourceKind === "manual"
                ? route.sourceKind
                : "manual";
            return [
              {
                id:
                  typeof route.id === "string" && route.id.trim()
                    ? route.id
                    : routeId(route.path),
                path: route.path,
                title:
                  typeof route.title === "string" && route.title.trim()
                    ? route.title
                    : titleFromRoutePath(route.path),
                sourceFile:
                  typeof route.sourceFile === "string"
                    ? route.sourceFile
                    : undefined,
                sourceKind,
                screenshotUrl:
                  typeof route.screenshotUrl === "string"
                    ? route.screenshotUrl
                    : undefined,
                metadata:
                  route.metadata &&
                  typeof route.metadata === "object" &&
                  !Array.isArray(route.metadata)
                    ? (route.metadata as Record<string, unknown>)
                    : undefined,
              },
            ];
          })
        : [];
      if (savedRoutes.length > 0) {
        const savedPaths = new Set(savedRoutes.map((route) => route.path));
        return {
          path: manifestPath,
          created: false,
          routes: [
            ...savedRoutes,
            ...options.routes.filter((route) => !savedPaths.has(route.path)),
          ],
        };
      }
    } catch {
      // Never overwrite a malformed/custom file. Route discovery remains a
      // safe runtime fallback and the user can repair the manifest in place.
    }
    return { path: manifestPath, created: false, routes: options.routes };
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
  return {
    path: manifestPath,
    created: !options.dryRun,
    routes: options.routes,
  };
}

export async function prepareDesignConnectManifest(
  options: Partial<DesignConnectArgs> & { root?: string } = {},
): Promise<DesignConnectManifest> {
  const root = path.resolve(options.root ?? process.cwd());
  const port = options.port ?? DEFAULT_BRIDGE_PORT;
  const devServerUrl = await resolveDevServerUrl(options.url);
  const bridgeUrl = `http://127.0.0.1:${port}`;
  const discoveredRoutes = discoverDesignRoutes(root);
  const routeManifest = await ensureRouteManifest({
    root,
    routeManifestPath: options.routeManifest ?? ROUTE_MANIFEST_FILE,
    routes: discoveredRoutes,
    devServerUrl,
    dryRun: Boolean(options.dryRun),
  });
  const generatedAt = new Date().toISOString();
  const routes = routeManifest.routes;

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
          ?
            "React development builds resolve jsxDEV call sites automatically; other runtimes can emit data-source-file / data-source-line / data-component-name attributes."
          : undefined,
    })),
  };
}

const BRIDGE_CORS_HEADERS = Symbol("agent-native-design-bridge-cors");

type CorsAwareResponse = ServerResponse & {
  [BRIDGE_CORS_HEADERS]?: Record<string, string>;
};

function isLoopbackOrigin(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function isApprovedDesignOrigin(
  rawOrigin: string,
  configuredOrigins: ReadonlySet<string>,
  opaquePreviewAuthorized = false,
): boolean {
  // only approved when this request carries the non-cookie preview token;
  // sibling opaque frames must not be able to spend this bridge's cookie.
  if (rawOrigin === "null") return opaquePreviewAuthorized;
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (parsed.origin !== rawOrigin) return false;
  if (configuredOrigins.has(parsed.origin)) return true;
  if (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    isLoopbackOrigin(parsed)
  ) {
    return true;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.hostname === "design.agent-native.com" ||
      parsed.hostname.endsWith(".design.agent-native.com"))
  );
}

function configureBridgeCors(
  req: IncomingMessage,
  res: ServerResponse,
  configuredOrigins: ReadonlySet<string>,
  opaquePreviewAuthorized = false,
): boolean {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : "";
  const approved = origin
    ? isApprovedDesignOrigin(origin, configuredOrigins, opaquePreviewAuthorized)
    : false;
  (res as CorsAwareResponse)[BRIDGE_CORS_HEADERS] = approved
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods":
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers":
          "accept, authorization, content-type, x-agent-native-browser-tab, x-agent-native-build-id, x-agent-native-client-compatibility, x-agent-native-client-platform, x-agent-native-csrf, x-agent-native-desktop-verifier, x-agent-native-embed-target, x-agent-native-embed-transplant, x-agent-native-frontend, x-agent-native-live-edit-capability, x-agent-native-live-edit-registration-capability, x-agent-native-session-id, x-bridge-token, x-csrf-token, x-design-preview-token, x-request-source, x-requested-with, x-xsrf-token, x-user-timezone",
        "access-control-allow-credentials": "true",
        "access-control-allow-private-network": "true",
        vary: "Origin",
      }
    : {};
  return approved;
}

function bridgeCorsHeaders(res: ServerResponse): Record<string, string> {
  return (res as CorsAwareResponse)[BRIDGE_CORS_HEADERS] ?? {};
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...bridgeCorsHeaders(res),
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
  setCookieHeaders: string[] = [],
  extraHeaders: Record<string, string> = {},
) {
  res.writeHead(statusCode, {
    "content-type": contentType,
    ...extraHeaders,
    ...(setCookieHeaders.length > 0 ? { "set-cookie": setCookieHeaders } : {}),
    ...bridgeCorsHeaders(res),
  });
  res.end(body);
}

function sendBytes(
  res: ServerResponse,
  statusCode: number,
  body: Buffer,
  headers: Headers,
  contentLength = body.length,
  setCookieHeaders: string[] = [],
  extraHeaders: Record<string, string> = {},
  transformed = false,
) {
  const responseHeaders: Record<string, string | string[]> = {
    ...extraHeaders,
    ...bridgeCorsHeaders(res),
    "content-length": String(contentLength),
    ...(setCookieHeaders.length > 0 ? { "set-cookie": setCookieHeaders } : {}),
  };
  for (const name of [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    if (transformed && name !== "content-type") continue;
    const value = headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  if (transformed) responseHeaders["cache-control"] = "no-store";
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

function constantTimeTokenMatches(
  providedToken: string,
  expectedToken: string,
): boolean {
  try {
    return (
      providedToken.length === expectedToken.length &&
      crypto.timingSafeEqual(
        Buffer.from(providedToken, "utf8"),
        Buffer.from(expectedToken, "utf8"),
      )
    );
  } catch {
    return false;
  }
}

function readHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

function isJsonRequest(req: IncomingMessage): boolean {
  return (
    readHeader(req, "content-type").split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

function readRequestCookie(req: IncomingMessage, name: string): string {
  for (const rawPair of readHeader(req, "cookie").split(";")) {
    const pair = rawPair.trim();
    const separator = pair.indexOf("=");
    if (separator <= 0 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return "";
}

function previewSessionSetCookie(previewToken: string): string {
  // Partitioned SameSite=None keeps the read-only bridge credential available
  return `${PREVIEW_SESSION_COOKIE_NAME}=${previewToken}; HttpOnly; Path=/; SameSite=None; Secure; Partitioned`;
}

/**
 * Preserve only browser metadata a local dev server needs to classify module
 * requests and parse ordinary same-origin app mutations. Browser cookies and
 * Authorization are forwarded only when Sec-Fetch-Site says the request came
 * from the proxied app itself; cross-site callers cannot relay them. Bridge
 * control tokens and referrers are never forwarded, and mutation origins are
 * replaced with the connected dev-server origin. Cookie-backed login also
 * uses the isolated in-memory upstream jar below so iframe cookie restrictions
 * cannot split the session across URL-backed screens.
 */
function previewProxyRequestHeaders(
  req: IncomingMessage,
  devServerUrl: string,
  cookieHeader = "",
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "x-csrf-token",
    "x-xsrf-token",
    "x-requested-with",
  ] as const) {
    const value = readHeader(req, name);
    if (value) headers[name] = value;
  }
  const browserSameOrigin = readHeader(req, "sec-fetch-site") === "same-origin";
  const browserCookie = browserSameOrigin ? readHeader(req, "cookie") : "";
  const mergedCookie = mergePreviewCookieHeaders(cookieHeader, browserCookie);
  if (mergedCookie) headers["cookie"] = mergedCookie;
  if (browserSameOrigin) {
    const authorization = readHeader(req, "authorization");
    if (authorization && authorization.length <= 16 * 1024) {
      headers["authorization"] = authorization;
    }
  }
  if (req.method && !["GET", "HEAD"].includes(req.method)) {
    headers["origin"] = new URL(devServerUrl).origin;
  }
  return headers;
}

function mergePreviewCookieHeaders(
  jarCookieHeader: string,
  browserCookieHeader: string,
): string {
  const values = new Map<string, string>();
  const absorb = (header: string) => {
    if (!header || Buffer.byteLength(header) > MAX_PREVIEW_COOKIE_BYTES) return;
    for (const rawPair of header.split(";")) {
      const pair = rawPair.trim();
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
      if (/^(?:x-)?agent-native-(?:bridge|preview)(?:-|$)/i.test(name)) {
        continue;
      }
      values.set(name, value);
    }
  };
  absorb(jarCookieHeader);
  absorb(browserCookieHeader);
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

const MAX_PREVIEW_SESSION_COOKIES = 128;
const MAX_PREVIEW_COOKIE_BYTES = 8 * 1024;

type PreviewSessionCookie = {
  name: string;
  value: string;
  path: string;
  secure: boolean;
  expiresAt?: number;
};

function responseSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function defaultCookiePath(url: URL): string {
  const pathname = url.pathname || "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function sanitizedBridgeSetCookie(raw: string): string {
  return raw
    .split(";")
    .filter((part) => !/^\s*domain\s*=/i.test(part))
    .join(";");
}

/**
 * Ephemeral cookie session for one connected dev-server origin. Cookies never
 * enter SQL, disk, logs, or another target origin, and disappear when the
 * local bridge exits. This keeps authenticated URL screens in one bridge
 * process on the same upstream session even when browser third-party-cookie
 * rules would otherwise isolate or reject the nested iframe cookies.
 */
class PreviewSessionCookieJar {
  private readonly origin: string;
  private readonly cookies = new Map<string, PreviewSessionCookie>();

  constructor(devServerUrl: string) {
    this.origin = new URL(devServerUrl).origin;
  }

  store(headers: Headers, responseUrl: string): string[] {
    const parsedUrl = new URL(responseUrl);
    if (parsedUrl.origin !== this.origin) return [];
    const browserCookies: string[] = [];
    for (const raw of responseSetCookieHeaders(headers)) {
      if (!raw || Buffer.byteLength(raw) > MAX_PREVIEW_COOKIE_BYTES) continue;
      const parts = raw.split(";");
      const first = parts.shift()?.trim() ?? "";
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
      let cookiePath = defaultCookiePath(parsedUrl);
      let secure = false;
      let expiresAt: number | undefined;
      let deleteCookie = false;
      for (const attribute of parts) {
        const trimmed = attribute.trim();
        const equals = trimmed.indexOf("=");
        const key = (equals < 0 ? trimmed : trimmed.slice(0, equals))
          .trim()
          .toLowerCase();
        const attributeValue =
          equals < 0 ? "" : trimmed.slice(equals + 1).trim();
        if (key === "path" && attributeValue.startsWith("/")) {
          cookiePath = attributeValue;
        } else if (key === "secure") {
          secure = true;
        } else if (key === "max-age") {
          const seconds = Number(attributeValue);
          if (Number.isFinite(seconds)) {
            deleteCookie = seconds <= 0;
            expiresAt = Date.now() + seconds * 1000;
          }
        } else if (key === "expires" && expiresAt === undefined) {
          const parsed = Date.parse(attributeValue);
          if (Number.isFinite(parsed)) expiresAt = parsed;
        }
      }
      const mapKey = `${cookiePath}\u0000${name}`;
      if (
        deleteCookie ||
        (expiresAt !== undefined && expiresAt <= Date.now())
      ) {
        this.cookies.delete(mapKey);
      } else {
        this.cookies.delete(mapKey);
        this.cookies.set(mapKey, {
          name,
          value,
          path: cookiePath,
          secure,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
        while (this.cookies.size > MAX_PREVIEW_SESSION_COOKIES) {
          const oldest = this.cookies.keys().next().value;
          if (typeof oldest !== "string") break;
          this.cookies.delete(oldest);
        }
      }
      browserCookies.push(sanitizedBridgeSetCookie(raw));
    }
    return browserCookies;
  }

  headerFor(targetUrl: string): string {
    const parsed = new URL(targetUrl);
    if (parsed.origin !== this.origin) return "";
    const now = Date.now();
    const matches: PreviewSessionCookie[] = [];
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (
        cookie.secure &&
        parsed.protocol !== "https:" &&
        !isLoopbackOrigin(parsed)
      ) {
        continue;
      }
      const pathMatches =
        cookie.path === "/" ||
        parsed.pathname === cookie.path ||
        (cookie.path.endsWith("/")
          ? parsed.pathname.startsWith(cookie.path)
          : parsed.pathname.startsWith(`${cookie.path}/`));
      if (!pathMatches) continue;
      matches.push(cookie);
    }
    matches.sort((a, b) => b.path.length - a.path.length);
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
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
  const search = stripQueryPair(parsed.search, FRAME_BRIDGE_KEY_PARAM);
  return `${parsed.origin}${parsed.pathname}${search}`;
}

function stripPreviewTokenQueryParam(search: string): string {
  if (!search.includes("previewToken")) return search;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const kept = raw
    .split("&")
    .filter(
      (pair) => pair !== "previewToken" && !pair.startsWith("previewToken="),
    );
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

function isFrameNavigationRequest(req: IncomingMessage): boolean {
  const dest = readHeader(req, "sec-fetch-dest");
  return dest === "document" || dest === "iframe" || dest === "frame";
}

const FRAME_BRIDGE_KEY_PARAM = "agentNativeBridgeKey";

function bridgeKeyFromUrl(url: URL): string {
  if (url.pathname === "/live-edit") {
    return url.searchParams.get("bridgeKey")?.trim() ?? "";
  }
  return url.searchParams.get(FRAME_BRIDGE_KEY_PARAM)?.trim() ?? "";
}

function keyedFrameNavigation(
  requestUrl: URL,
  referer: string | undefined,
  bridgeUrl: string,
): { bridgeKey: string; previewToken: string } | null {
  const origin = new URL(bridgeUrl).origin;
  const candidates: URL[] = [];
  if (requestUrl.origin === origin) candidates.push(requestUrl);
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === origin) candidates.push(url);
    } catch {
      // coercion-ok: an unparseable referer carries no bridge identity.
    }
  }
  for (const url of candidates) {
    const bridgeKey = bridgeKeyFromUrl(url);
    if (!bridgeKey) continue;
    return {
      bridgeKey,
      previewToken: url.searchParams.get("previewToken")?.trim() ?? "",
    };
  }
  return null;
}

function stripQueryPair(search: string, name: string): string {
  if (!search) return search;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const kept = raw.split("&").filter((pair) => {
    const rawName = pair.split("=", 1)[0] ?? pair;
    let decoded = rawName;
    try {
      decoded = decodeURIComponent(rawName);
    } catch {
      // coercion-ok: an undecodable name is not this param.
    }
    return decoded !== name;
  });
  const next = kept.join("&");
  return next ? `?${next}` : "";
}

function appendQueryPair(search: string, name: string, value: string): string {
  const pair = `${name}=${encodeURIComponent(value)}`;
  if (!search || search === "?") return `?${pair}`;
  return `${search}&${pair}`;
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
  cookieJar?: PreviewSessionCookieJar,
  redirects = 0,
): Promise<{
  url: string;
  status: number;
  contentType: string;
  html: string;
  setCookieHeaders: string[];
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
        ...(cookieJar?.headerFor(targetUrl)
          ? { cookie: cookieJar.headerFor(targetUrl) }
          : {}),
      },
    });
    const setCookieHeaders =
      cookieJar?.store(response.headers, targetUrl) ?? [];
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
        cookieJar,
        redirects + 1,
      );
    }
    return {
      url: response.url || targetUrl,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      html: await response.text(),
      setCookieHeaders,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPreviewProxyResource(
  devServerUrl: string,
  targetUrl: string,
  request: {
    method: string;
    headers?: Record<string, string>;
    body?: Buffer;
  },
  cookieJar?: PreviewSessionCookieJar,
  redirects = 0,
): Promise<{
  url: string;
  status: number;
  headers: Headers;
  body: Buffer;
  setCookieHeaders: string[];
}> {
  if (redirects > 5) {
    throw new Error("Too many redirects while proxying preview resource.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      redirect: "manual",
      signal: controller.signal,
      headers: request.headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
    });
    const setCookieHeaders =
      cookieJar?.store(response.headers, targetUrl) ?? [];
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const redirected = new URL(location, targetUrl);
      redirected.hash = "";
      if (!sameOrigin(redirected.toString(), devServerUrl)) {
        throw new Error("Proxy redirect left the connected dev server.");
      }
      const switchToGet =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          request.method === "POST");
      const redirectedResponse = await fetchPreviewProxyResource(
        devServerUrl,
        redirected.toString(),
        {
          method: switchToGet ? "GET" : request.method,
          headers: {
            ...(request.headers ?? {}),
            ...(cookieJar?.headerFor(redirected.toString())
              ? { cookie: cookieJar.headerFor(redirected.toString()) }
              : {}),
          },
          body: switchToGet ? undefined : request.body,
        },
        cookieJar,
        redirects + 1,
      );
      return {
        ...redirectedResponse,
        setCookieHeaders: [
          ...setCookieHeaders,
          ...redirectedResponse.setCookieHeaders,
        ],
      };
    }
    return {
      url: response.url || targetUrl,
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
      setCookieHeaders,
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

function addPreviewTokenToResourceUrl(
  resourceUrl: string,
  previewToken: string,
): string {
  if (!resourceUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(resourceUrl)) {
    return resourceUrl;
  }
  const hashIndex = resourceUrl.indexOf("#");
  const path = hashIndex === -1 ? resourceUrl : resourceUrl.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : resourceUrl.slice(hashIndex);
  if (!path) return resourceUrl;
  const queryIndex = path.indexOf("?");
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : path.slice(queryIndex);
  const withoutStaleToken = stripQueryPair(search, "previewToken");
  return `${pathname}${appendQueryPair(withoutStaleToken, "previewToken", previewToken)}${hash}`;
}

function addOpaqueFrameCredentials(
  html: string,
  previewToken?: string,
): string {
  const withCredentialedResources = html.replace(
    /<(script|link|img|audio|video|source|track|iframe)\b([^>]*?)>/gi,
    (fullTag, tagName: string, attributes: string) => {
      const resourceMatch = attributes.match(
        /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      );
      const resourceUrl =
        resourceMatch?.[2] ?? resourceMatch?.[3] ?? resourceMatch?.[4] ?? "";
      if (!resourceUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(resourceUrl)) {
        return fullTag;
      }
      let nextAttributes = attributes;
      if (previewToken) {
        const tokenizedResourceUrl = addPreviewTokenToResourceUrl(
          resourceUrl,
          previewToken,
        );
        if (tokenizedResourceUrl !== resourceUrl) {
          nextAttributes = nextAttributes.replace(
            resourceMatch[0],
            resourceMatch[0].replace(resourceUrl, tokenizedResourceUrl),
          );
        }
      }
      if (
        tagName.toLowerCase() === "script" ||
        tagName.toLowerCase() === "link"
      ) {
        if (/\bcrossorigin\s*=/i.test(nextAttributes)) {
          nextAttributes = nextAttributes.replace(
            /\bcrossorigin\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
            'crossorigin="use-credentials"',
          );
        } else {
          nextAttributes += ' crossorigin="use-credentials"';
        }
      }
      return `<${tagName}${nextAttributes}>`;
    },
  );
  if (!previewToken) return withCredentialedResources;
  const withInlineStyleTokens = withCredentialedResources.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_full, opening: string, body: string, closing: string) =>
      `${opening}${addOpaqueFrameResourceTokens(body, previewToken)}${closing}`,
  );
  const withInlineModuleTokens = withInlineStyleTokens.replace(
    /(<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_full, opening: string, body: string, closing: string) =>
      `${opening}${addOpaqueFrameJavaScriptResourceTokens(body, previewToken)}${closing}`,
  );
  const hmrImport = "/@id/__x00__virtual:react-router/inject-hmr-runtime";
  const hmrImportWithToken = `${hmrImport}?previewToken=${encodeURIComponent(previewToken)}`;
  const withHmrToken = withInlineModuleTokens
    .replaceAll(`"${hmrImport}"`, `"${hmrImportWithToken}"`)
    .replaceAll(`'${hmrImport}'`, `'${hmrImportWithToken}'`);
  const previewTokenLiteral = JSON.stringify(previewToken).replace(
    /</g,
    "\\u003c",
  );
  const previewImportMap = JSON.stringify({
    imports: {
      "/@id/__x00__virtual:react-router/browser-manifest": `${hmrImport.replace(
        "/inject-hmr-runtime",
        "/browser-manifest",
      )}?previewToken=${encodeURIComponent(previewToken)}`,
      "/@id/__x00__virtual:react-router/hmr-runtime": `${hmrImport.replace(
        "/inject-hmr-runtime",
        "/hmr-runtime",
      )}?previewToken=${encodeURIComponent(previewToken)}`,
      "/@vite/client": `/@vite/client?previewToken=${encodeURIComponent(previewToken)}`,
    },
  });
  const withImportMap = injectDocumentMarkup(
    withHmrToken,
    `<script type="importmap" data-agent-native-opaque-preview-imports>${previewImportMap}</script>`,
    { target: "head" },
  );
  return injectDocumentMarkup(
    withImportMap,
    // coercion-ok: invalid browser-owned URLs stay unchanged in the frame.
    String.raw`<script data-agent-native-opaque-preview-auth>(function(){var t=${previewTokenLiteral},o,h;try{var b=new URL(document.baseURI);o=b.origin;h=b.host}catch(_){return}function u(v){try{var a=new URL(String(v),document.baseURI),same=a.origin===o||(h===a.host&&(a.protocol==="ws:"||a.protocol==="wss:"));if(!same||a.searchParams.has("previewToken"))return null;a.searchParams.set("previewToken",t);return a.toString()}catch(_){return null}}function c(v){return String(v).replace(/url\(\s*(["']?)([^"'()]+)\1\s*\)/gi,function(h,q,v){var s=u(v);return s?"url("+q+s+q+")":h})}var f=window.fetch.bind(window);window.fetch=function(i,n){var v=i instanceof Request?i.url:i,s=u(v);return s?f(i instanceof Request?new Request(s,i):s,n):f(i,n)};var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,v){var s=u(v);return x.call(this,m,s||v,...Array.prototype.slice.call(arguments,2))};var e=window.EventSource;if(e){var E=function(v,n){return new e(u(v)||v,n);};E.prototype=e.prototype;window.EventSource=E}var W=window.WebSocket;if(W){var S=function(v,p){var s=u(v);return p===undefined?new W(s||v):new W(s||v,p)};S.prototype=W.prototype;S.CONNECTING=W.CONNECTING;S.OPEN=W.OPEN;S.CLOSING=W.CLOSING;S.CLOSED=W.CLOSED;window.WebSocket=S}var p=Node.prototype.appendChild;Node.prototype.appendChild=function(n){if(n&&n.nodeType===1){var a=n.tagName==="SCRIPT"?"src":n.tagName==="LINK"?"href":n.tagName==="IMG"?"src":n.tagName==="IFRAME"?"src":null;if(a){var v=n.getAttribute(a),s=u(v);if(s)n.setAttribute(a,s)}else if(n.tagName==="STYLE"&&n.textContent){n.textContent=c(n.textContent)}}return p.call(this,n)}})();</script>`,
    { target: "head" },
  );
}

function addOpaqueFrameResourceTokens(
  css: string,
  previewToken: string,
): string {
  const withImportTokens = css.replace(
    /(@import\s+)(["'])([^"']+)\2/gi,
    (_full, prefix: string, quote: string, resourceUrl: string) =>
      `${prefix}${quote}${addPreviewTokenToResourceUrl(resourceUrl, previewToken)}${quote}`,
  );
  return withImportTokens.replace(
    /url\(\s*(["']?)([^"'()]+)\1\s*\)/gi,
    (full, quote: string, resourceUrl: string) => {
      const tokenizedResourceUrl = addPreviewTokenToResourceUrl(
        resourceUrl,
        previewToken,
      );
      return tokenizedResourceUrl === resourceUrl
        ? full
        : `url(${quote}${tokenizedResourceUrl}${quote})`;
    },
  );
}

function addOpaqueFrameJavaScriptResourceTokens(
  source: string,
  previewToken: string,
): string {
  const rewrite = (prefix: string, quote: string, resourceUrl: string) =>
    `${prefix}${quote}${addPreviewTokenToResourceUrl(resourceUrl, previewToken)}${quote}`;
  return source
    .replace(
      /(\b(?:import|export)\s+[^;\n]*?\sfrom\s*)(["'])((?:\/|\.{1,2}\/)(?:[^"']*))\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    )
    .replace(
      /(\bimport\s+)(["'])((?:\/|\.{1,2}\/)(?:[^"']*))\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    )
    .replace(
      /(\bimport\s*\(\s*)(["'])((?:\/|\.{1,2}\/)(?:[^"']*))\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    )
    .replace(
      /(\bnew\s+URL\s*\(\s*)(["'])((?:\/|\.{1,2}\/)(?:[^"']*))\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    )
    .replace(
      /((?:["']?)(?:module|clientActionModule|clientLoaderModule|clientMiddlewareModule|hydrateFallbackModule)(?:["']?)\s*:\s*)(["'])(\/(?:app|@id)\/[^"']*)\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    )
    .replace(
      /((?:["']?)(?:url|runtime)(?:["']?)\s*:\s*)(["'])(\/\@id\/__x00__virtual:react-router\/(?:browser-manifest|inject-hmr-runtime|hmr-runtime))\2/g,
      (_full, prefix: string, quote: string, resourceUrl: string) =>
        rewrite(prefix, quote, resourceUrl),
    );
}

const FRAME_IDENTITY_NAME_PREFIX = "agent-native-bridge:";

function injectPreBootLocationShim(
  html: string,
  targetPath: string,
  identity: { bridgeKey?: string; recoverTargetUrl?: string } = {},
): string {
  const path = targetPath.trim();
  if (!path || path === "/live-edit") return html;
  const prefix = JSON.stringify(FRAME_IDENTITY_NAME_PREFIX);
  const remember = identity.bridgeKey
    ? `if(!window.name||window.name.indexOf(${prefix})===0){window.name=${prefix}+${JSON.stringify(identity.bridgeKey)};}`
    : "";
  const recover = identity.recoverTargetUrl
    ? `if(window.name&&window.name.indexOf(${prefix})===0){var k=window.name.slice(${prefix}.length);if(k){location.replace("/live-edit?url="+encodeURIComponent(${JSON.stringify(identity.recoverTargetUrl)})+"&bridgeKey="+encodeURIComponent(k));return;}}`
    : "";
  // coercion-ok: browser-side JS injected ahead of the app; a replaceState or window.name failure must not break the app's own boot.
  const shimBody = `(function(){try{${recover}${remember}var p=${JSON.stringify(path)};if(p&&(location.pathname+location.search)!==p){history.replaceState(null,"",p);}}catch(e){}})();`;
  const shim = `<script data-agent-native-live-edit-location>\n${shimBody}\n</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${shim}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}<head>${shim}</head>`,
    );
  }
  return `${shim}${html}`;
}

function injectLiveEditBridge(
  html: string,
  baseHref: string,
  script: string,
  targetPath: string,
  identity: {
    bridgeKey?: string;
    previewToken?: string;
    recoverTargetUrl?: string;
  } = {},
) {
  const withBase = injectPreBootLocationShim(
    addOpaqueFrameCredentials(
      addLiveEditBaseHref(html, baseHref),
      identity.previewToken,
    ),
    targetPath,
    identity,
  );
  if (!script) return withBase;
  return injectDocumentMarkup(withBase, script);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const MAX_LIVE_EDIT_PENDING_PROMPT_LENGTH = 64 * 1024;
const MAX_LIVE_EDIT_PENDING_BYTES =
  MAX_LIVE_EDIT_PENDING_PROMPT_LENGTH + 8 * 1024;
const MAX_LIVE_EDIT_PENDING_DESIGNS = 32;
const MAX_LIVE_EDIT_BRIDGE_KEYS = 128;
const MAX_LIVE_EDIT_REVISION_DESIGNS = 256;
const LIVE_EDIT_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type LiveEditPendingEntry = {
  revision: number;
  pending: Record<string, unknown> | null;
  updatedAt: number;
};

function pruneLiveEditPendingEntries(
  entries: Map<string, LiveEditPendingEntry>,
  now: number,
) {
  for (const [designId, entry] of entries) {
    if (now - entry.updatedAt >= LIVE_EDIT_PENDING_TTL_MS) {
      entries.delete(designId);
    }
  }
}

function sameLiveEditPendingPayload(
  current: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): boolean {
  if (current === null || next === null) return current === next;
  return (
    current.designId === next.designId &&
    current.pendingEditCount === next.pendingEditCount &&
    current.status === next.status &&
    current.prompt === next.prompt
  );
}

function storeLiveEditPendingEntry(
  entries: Map<string, LiveEditPendingEntry>,
  revisionHighWaterMarks: Map<string, number>,
  designId: string,
  revision: number,
  pending: Record<string, unknown> | null,
  now: number,
): "stored" | "stale" | "conflict" | "capacity" {
  pruneLiveEditPendingEntries(entries, now);
  const existing = entries.get(designId);
  const highWaterMark = revisionHighWaterMarks.get(designId);
  if (
    highWaterMark === undefined &&
    revisionHighWaterMarks.size >= MAX_LIVE_EDIT_REVISION_DESIGNS
  ) {
    return "capacity";
  }
  if (highWaterMark !== undefined && revision < highWaterMark) return "stale";
  if (highWaterMark === revision) {
    if (!existing) return "stale";
    if (!sameLiveEditPendingPayload(existing.pending, pending))
      return "conflict";
    entries.delete(designId);
    entries.set(designId, { ...existing, updatedAt: now });
    return "stored";
  }
  revisionHighWaterMarks.set(designId, revision);
  entries.delete(designId);
  entries.set(designId, { revision, pending, updatedAt: now });
  while (entries.size > MAX_LIVE_EDIT_PENDING_DESIGNS) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== "string") break;
    entries.delete(oldest);
  }
  return "stored";
}

async function readLiveEditRevisionHighWaterMarks(
  rootPath: string,
): Promise<Map<string, number>> {
  const filePath = path.join(rootPath, LIVE_EDIT_REVISION_FILE);
  let serialized: string;
  try {
    serialized = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const parsed: unknown = JSON.parse(serialized);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    !("revisions" in parsed) ||
    !parsed.revisions ||
    typeof parsed.revisions !== "object" ||
    Array.isArray(parsed.revisions)
  ) {
    throw new Error("Invalid live-edit revision high-water file");
  }
  const revisions = Object.entries(parsed.revisions);
  if (revisions.length > MAX_LIVE_EDIT_REVISION_DESIGNS) {
    throw new Error(
      "Live-edit revision high-water file exceeds its design cap",
    );
  }
  const marks = new Map<string, number>();
  for (const [designId, revision] of revisions) {
    if (
      !designId ||
      !Number.isSafeInteger(revision) ||
      (revision as number) < 1
    ) {
      throw new Error("Invalid live-edit revision high-water entry");
    }
    marks.set(designId, revision as number);
  }
  return marks;
}

async function writeLiveEditRevisionHighWaterMarks(
  rootPath: string,
  marks: Map<string, number>,
): Promise<void> {
  const filePath = path.join(rootPath, LIVE_EDIT_REVISION_FILE);
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ version: 1, revisions: Object.fromEntries(marks) }),
        "utf8",
      );
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function storePersistentLiveEditPendingEntry(
  entries: Map<string, LiveEditPendingEntry>,
  revisionHighWaterMarks: Map<string, number>,
  rootPath: string,
  designId: string,
  revision: number,
  pending: Record<string, unknown> | null,
  now: number,
): Promise<"stored" | "stale" | "conflict" | "capacity"> {
  const nextEntries = new Map(entries);
  const nextMarks = new Map(revisionHighWaterMarks);
  const stored = storeLiveEditPendingEntry(
    nextEntries,
    nextMarks,
    designId,
    revision,
    pending,
    now,
  );
  if (stored !== "stored") return stored;
  if (nextMarks.get(designId) !== revisionHighWaterMarks.get(designId)) {
    try {
      await writeLiveEditRevisionHighWaterMarks(rootPath, nextMarks);
    } catch (error) {
      throw new LiveEditRevisionPersistenceError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  entries.clear();
  for (const [key, entry] of nextEntries) entries.set(key, entry);
  revisionHighWaterMarks.clear();
  for (const [key, mark] of nextMarks) revisionHighWaterMarks.set(key, mark);
  return "stored";
}

class LiveEditPendingRequestTooLargeError extends Error {}
class LiveEditRevisionPersistenceError extends Error {}

async function readLiveEditPendingBody(req: IncomingMessage): Promise<string> {
  const declaredLength = Number(readHeader(req, "content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_LIVE_EDIT_PENDING_BYTES
  ) {
    throw new LiveEditPendingRequestTooLargeError(
      "Pending visual edit payload exceeds the 64 KB prompt limit.",
    );
  }
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LIVE_EDIT_PENDING_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(
          new LiveEditPendingRequestTooLargeError(
            "Pending visual edit payload exceeds the 64 KB prompt limit.",
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

const MAX_PREVIEW_PROXY_REQUEST_BYTES = 8 * 1024 * 1024;

class PreviewProxyRequestTooLargeError extends Error {}

async function readPreviewProxyRequestBody(
  req: IncomingMessage,
): Promise<Buffer> {
  const declaredLength = Number(readHeader(req, "content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PREVIEW_PROXY_REQUEST_BYTES
  ) {
    throw new PreviewProxyRequestTooLargeError(
      "Preview request body exceeds the 8 MB limit.",
    );
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PREVIEW_PROXY_REQUEST_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(
          new PreviewProxyRequestTooLargeError(
            "Preview request body exceeds the 8 MB limit.",
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function assertPathInside(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = await fs.realpath(rootPath).catch(() => {
    throw new Error(`Bridge root path does not exist: ${rootPath}`);
  });

  const targetParent = path.dirname(path.resolve(rootPath, targetPath));
  const resolvedParent = await fs.realpath(targetParent).catch(async () => {
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

interface SafeBridgeFileTarget {
  absolutePath: string;
  canonicalPath: string;
}

async function resolveSafeBridgeFileTarget(
  rootPath: string,
  targetPath: string,
): Promise<SafeBridgeFileTarget> {
  await assertPathInside(rootPath, targetPath);
  const resolvedRoot = await fs.realpath(rootPath);
  const absolutePath = path.resolve(rootPath, targetPath);
  let existingAncestor = path.dirname(absolutePath);
  let resolvedAncestor: string | null = null;
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      resolvedAncestor = await fs.realpath(existingAncestor);
      break;
    } catch {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) break;
      existingAncestor = parent;
    }
  }
  if (!resolvedAncestor) {
    throw new Error(`Cannot resolve parent directory: ${absolutePath}`);
  }
  const canonicalPath =
    (await fs.realpath(absolutePath).catch(() => null)) ??
    path.resolve(
      resolvedAncestor,
      path.relative(existingAncestor, absolutePath),
    );
  if (
    canonicalPath !== resolvedRoot &&
    !canonicalPath.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("Path traversal detected: resolved target is outside root");
  }
  return { absolutePath, canonicalPath };
}

const bridgeWriteLocks = new Map<string, Promise<void>>();

async function withBridgeWriteLock<T>(
  canonicalPath: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = bridgeWriteLocks.get(canonicalPath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  bridgeWriteLocks.set(canonicalPath, queued);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (bridgeWriteLocks.get(canonicalPath) === queued) {
      bridgeWriteLocks.delete(canonicalPath);
    }
  }
}

interface BridgeFileSnapshot {
  content: string;
  versionHash: string;
  mode: number;
}

function contentVersionHash(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function readBridgeFileSnapshot(
  absolutePath: string,
): Promise<BridgeFileSnapshot | null> {
  const noFollow = fsSync.constants.O_NOFOLLOW ?? 0;
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(absolutePath, fsSync.constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Bridge target is not a regular file: ${absolutePath}`);
    }
    const bytes = await handle.readFile();
    return {
      content: bytes.toString("utf8"),
      versionHash: contentVersionHash(bytes),
      mode: stat.mode & 0o777,
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

class BridgeVersionConflictError extends Error {
  constructor(readonly currentVersionHash?: string) {
    super("version conflict");
  }
}

class BridgePreconditionRequiredError extends Error {
  constructor() {
    super("expectedVersionHash is required");
  }
}

function assertExpectedBridgeVersion(
  expectedVersionHash: string | undefined,
  currentVersionHash: string | undefined,
  requireExpectedVersionHash = false,
): void {
  if (requireExpectedVersionHash && expectedVersionHash === undefined) {
    throw new BridgePreconditionRequiredError();
  }
  if (
    expectedVersionHash !== undefined &&
    (currentVersionHash !== undefined
      ? currentVersionHash !== expectedVersionHash
      : requireExpectedVersionHash)
  ) {
    throw new BridgeVersionConflictError(currentVersionHash);
  }
}

async function atomicWriteBridgeFile(args: {
  rootPath: string;
  relPath: string;
  lockedCanonicalPath: string;
  content: string;
  expectedVersionHash?: string;
  requireExpectedVersionHash?: boolean;
  originalMode?: number;
}): Promise<string> {
  const parent = path.dirname(path.resolve(args.rootPath, args.relPath));
  await fs.mkdir(parent, { recursive: true });
  const revalidated = await resolveSafeBridgeFileTarget(
    args.rootPath,
    args.relPath,
  );
  if (revalidated.canonicalPath !== args.lockedCanonicalPath) {
    throw new Error("Bridge target changed while waiting for the write lock");
  }

  const basename = path.basename(revalidated.absolutePath);
  const tempPath = path.join(
    parent,
    `.${basename}.agent-native-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  const noFollow = fsSync.constants.O_NOFOLLOW ?? 0;
  let tempHandle: FileHandle | null = null;
  try {
    tempHandle = await fs.open(
      tempPath,
      fsSync.constants.O_CREAT |
        fsSync.constants.O_EXCL |
        fsSync.constants.O_WRONLY |
        noFollow,
      args.originalMode ?? 0o666,
    );
    await tempHandle.writeFile(args.content, "utf8");
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = null;

    const beforeRenameTarget = await resolveSafeBridgeFileTarget(
      args.rootPath,
      args.relPath,
    );
    if (beforeRenameTarget.canonicalPath !== args.lockedCanonicalPath) {
      throw new Error("Bridge target changed during atomic write");
    }
    const current = await readBridgeFileSnapshot(
      beforeRenameTarget.absolutePath,
    );
    assertExpectedBridgeVersion(
      args.expectedVersionHash,
      current?.versionHash,
      args.requireExpectedVersionHash,
    );

    await fs.rename(tempPath, beforeRenameTarget.absolutePath);
    const directoryHandle = await fs.open(parent, "r").catch(() => null);
    if (directoryHandle) {
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
    return contentVersionHash(args.content);
  } finally {
    await tempHandle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

const ALLOWED_NEW_TEXT_FILE_EXTENSIONS = new Set([
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
  ".py",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".toml",
  ".xml",
  ".graphql",
  ".gql",
  ".prisma",
  ".properties",
  ".ini",
  ".conf",
  ".env.example",
]);

const ALLOWED_NEW_EXTENSIONLESS_TEXT_FILES = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "gemfile",
  "rakefile",
  "license",
  "readme",
]);

const BLOCKED_BINARY_WRITE_EXTENSIONS = new Set([
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
  ".exe",
  ".dll",
  ".dylib",
  ".so",
  ".class",
  ".jar",
]);

function assertEditableTextFile(
  relPath: string,
  existing: BridgeFileSnapshot | null,
): void {
  const ext = path.extname(relPath).toLowerCase();
  if (BLOCKED_BINARY_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Write rejected: extension "${ext}" is a binary file type.`,
    );
  }
  if (existing) {
    if (existing.content.includes("\0")) {
      throw new Error(
        "Write rejected: the existing file contains binary data.",
      );
    }
    return;
  }
  const basename = path.basename(relPath).toLowerCase();
  if (
    !ALLOWED_NEW_TEXT_FILE_EXTENSIONS.has(ext) &&
    !ALLOWED_NEW_EXTENSIONLESS_TEXT_FILES.has(basename)
  ) {
    throw new Error(
      `Write rejected: extension "${ext || "(no extension)"}" is not recognized for a new text/code file.`,
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
  pattern: string;
  anchored: boolean;
  dirOnly: boolean;
}

export function parseGitignore(contents: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) continue;
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
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);

      if (entry.isSymbolicLink()) {
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
  seedOrOptions?: string | DesignConnectBridgeOptions,
): Promise<DesignConnectBridge> {
  const options: DesignConnectBridgeOptions =
    typeof seedOrOptions === "string"
      ? { bridgeToken: seedOrOptions }
      : (seedOrOptions ?? {});
  const configuredBridgeToken =
    options.bridgeToken || process.env["AGENT_NATIVE_BRIDGE_TOKEN"];
  const bridgeToken = await resolveBridgeToken(
    manifest.rootPath,
    configuredBridgeToken,
    false,
  );
  const configuredPreviewToken = options.previewToken;
  const derivedPreviewToken = deriveDesignPreviewToken(bridgeToken);
  if (
    configuredPreviewToken &&
    configuredPreviewToken !== derivedPreviewToken
  ) {
    throw new Error(
      "previewToken must match the deterministic token derived from bridgeToken",
    );
  }
  if (
    process.env["AGENT_NATIVE_PREVIEW_TOKEN"] &&
    process.env["AGENT_NATIVE_PREVIEW_TOKEN"] !== derivedPreviewToken
  ) {
    console.warn(
      "Ignoring stale AGENT_NATIVE_PREVIEW_TOKEN; the current bridge token determines the preview token.",
    );
  }
  const previewToken = derivedPreviewToken;
  const configuredOrigins = new Set(
    (options.allowedOrigins ?? []).flatMap((raw): string[] => {
      try {
        return [new URL(raw).origin];
      } catch {
        return [];
      }
    }),
  );
  let liveEditBridgeScript = "";
  const pendingVisualEditPayloads = new Map<string, LiveEditPendingEntry>();
  const pendingVisualEditRevisionHighWaterMarks =
    await readLiveEditRevisionHighWaterMarks(manifest.rootPath);
  let pendingVisualEditWriteQueue = Promise.resolve();
  const storePendingVisualEdit = async (
    designId: string,
    revision: number,
    pending: Record<string, unknown> | null,
    now: number,
  ) => {
    const previous = pendingVisualEditWriteQueue;
    let release!: () => void;
    pendingVisualEditWriteQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await storePersistentLiveEditPendingEntry(
        pendingVisualEditPayloads,
        pendingVisualEditRevisionHighWaterMarks,
        manifest.rootPath,
        designId,
        revision,
        pending,
        now,
      );
    } finally {
      release();
    }
  };
  const liveEditBridgeScripts = new Map<string, string>();
  const liveEditBridgeDesignIds = new Map<string, string>();
  const isRegisteredDesign = (designId: string) =>
    Array.from(liveEditBridgeDesignIds.values()).includes(designId);
  const isValidLiveEditCapability = (req: IncomingMessage, designId: string) =>
    constantTimeTokenMatches(
      readHeader(req, "x-agent-native-live-edit-capability"),
      deriveDesignScopedLiveEditCapability(bridgeToken, designId),
    );
  const isValidLiveEditRegistrationCapability = (
    req: IncomingMessage,
    designId: string,
  ) =>
    constantTimeTokenMatches(
      readHeader(req, "x-agent-native-live-edit-registration-capability"),
      deriveDesignScopedLiveEditRegistrationCapability(bridgeToken, designId),
    );
  const bridgeInstanceId = crypto.randomBytes(16).toString("hex");
  const previewSessionCookies = new PreviewSessionCookieJar(
    manifest.devServerUrl,
  );

  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? "/", manifest.bridgeUrl);
      const pathname = requestUrl.pathname;
      const explicitPreviewToken =
        readHeader(req, "x-design-preview-token") ||
        requestUrl.searchParams.get("previewToken") ||
        "";
      const providedPreviewToken =
        explicitPreviewToken ||
        readRequestCookie(req, PREVIEW_SESSION_COOKIE_NAME) ||
        "";
      const previewTokenValid = constantTimeTokenMatches(
        providedPreviewToken,
        previewToken,
      );
      const explicitPreviewTokenValid = constantTimeTokenMatches(
        explicitPreviewToken,
        previewToken,
      );
      const corsApproved = configureBridgeCors(
        req,
        res,
        configuredOrigins,
        explicitPreviewTokenValid && readHeader(req, "origin") === "null",
      );
      const requestOrigin = readHeader(req, "origin");
      const crossSiteRequest =
        readHeader(req, "sec-fetch-site").trim().toLowerCase() === "cross-site";
      if (req.method === "OPTIONS") {
        sendJson(
          res,
          corsApproved ? 204 : 403,
          corsApproved
            ? {}
            : { ok: false, error: "origin is not allowed by this bridge" },
        );
        return;
      }
      const rejectInvalidPreviewToken = (): boolean => {
        if (previewTokenValid) return false;
        sendJson(res, 401, {
          ok: false,
          error: "invalid or missing preview token",
        });
        return true;
      };

      // ── Read-only preview routes (preview token required) ────────────────

      const isProxiedAppManifestRequest =
        (req.method === "GET" || req.method === "HEAD") &&
        pathname === "/manifest.json" &&
        readHeader(req, "sec-fetch-dest") === "manifest";
      const frameNavigationDest = readHeader(req, "sec-fetch-dest");
      const isFrameNavigation =
        frameNavigationDest === "document" ||
        frameNavigationDest === "iframe" ||
        frameNavigationDest === "frame";
      if (
        !isProxiedAppManifestRequest &&
        (pathname === "/manifest.json" ||
          (pathname === "/" && !isFrameNavigation))
      ) {
        if (rejectInvalidPreviewToken()) return;
        const challenge = requestUrl.searchParams
          .get("attestationChallenge")
          ?.trim();
        sendJson(res, 200, {
          ...manifest,
          ...(challenge && /^[A-Za-z0-9_-]{32}$/.test(challenge)
            ? {
                attestation: {
                  challenge,
                  signature: deriveDesignPreviewAttestationSignature(
                    bridgeToken,
                    challenge,
                  ),
                },
              }
            : {}),
        });
        return;
      }
      if (pathname === "/routes.json") {
        if (rejectInvalidPreviewToken()) return;
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
        sendJson(res, 200, {
          ok: true,
          source: manifest.source,
          appFingerprint: designConnectAppFingerprint(manifest),
          bridgeInstanceId,
        });
        return;
      }
      if (pathname === "/live-edit-bridge") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        if (!explicitPreviewTokenValid) {
          sendJson(res, 401, {
            ok: false,
            error:
              "live-edit bridge registration requires the preview token header",
          });
          return;
        }
        if (
          requestOrigin === "null" ||
          (!requestOrigin && crossSiteRequest) ||
          (requestOrigin && !corsApproved)
        ) {
          sendJson(res, 403, {
            ok: false,
            error: "origin is not allowed by this bridge",
          });
          return;
        }
        if (!isJsonRequest(req)) {
          sendJson(res, 415, {
            ok: false,
            error: "live-edit bridge registration requires application/json",
          });
          return;
        }
        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as Record<string, unknown>;
            const script =
              typeof body["script"] === "string" ? body["script"] : "";
            const bridgeKey =
              typeof body["bridgeKey"] === "string"
                ? body["bridgeKey"].trim()
                : "";
            const designId =
              typeof body["designId"] === "string"
                ? body["designId"].trim()
                : "";
            if (
              !designId ||
              !bridgeKey ||
              (!isValidLiveEditCapability(req, designId) &&
                !isValidLiveEditRegistrationCapability(req, designId))
            ) {
              sendJson(res, 403, {
                ok: false,
                error:
                  "live-edit registration requires a design-scoped registration capability",
              });
              return;
            }
            const installsSupportedDesignBridge =
              script.includes("agent-native:editor-chrome-ready") ||
              script.includes("embedded-canvas-pan");
            if (!installsSupportedDesignBridge) {
              sendJson(res, 400, {
                ok: false,
                error:
                  "script must install an approved Agent-Native editor or canvas-pan bridge",
              });
              return;
            }
            if (
              bridgeKey &&
              (!/^[a-zA-Z0-9:._-]+$/.test(bridgeKey) || bridgeKey.length > 128)
            ) {
              sendJson(res, 400, {
                ok: false,
                error: "bridgeKey must be 1-128 safe identifier characters",
              });
              return;
            }
            liveEditBridgeScript = script;
            if (bridgeKey) {
              liveEditBridgeScripts.delete(bridgeKey);
              liveEditBridgeScripts.set(bridgeKey, script);
              if (designId) {
                liveEditBridgeDesignIds.set(bridgeKey, designId);
              } else {
                liveEditBridgeDesignIds.delete(bridgeKey);
              }
              while (liveEditBridgeScripts.size > MAX_LIVE_EDIT_BRIDGE_KEYS) {
                const oldest = liveEditBridgeScripts.keys().next().value;
                if (typeof oldest !== "string") break;
                liveEditBridgeScripts.delete(oldest);
                liveEditBridgeDesignIds.delete(oldest);
              }
            }
            sendJson(res, 200, {
              ok: true,
              bridgeInstanceId,
              ...(bridgeKey ? { bridgeKey } : {}),
              ...(designId ? { designId } : {}),
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
      if (pathname === "/live-edit-pending") {
        if (req.method === "GET") {
          if (rejectInvalidPreviewToken()) return;
          const designId = requestUrl.searchParams.get("designId")?.trim();
          if (!designId) {
            sendJson(res, 400, {
              ok: false,
              error: "designId is required to read pending visual edits",
            });
            return;
          }
          if (!isValidLiveEditCapability(req, designId)) {
            sendJson(res, 403, {
              ok: false,
              error: "pending read requires a design-scoped capability",
            });
            return;
          }
          if (!isRegisteredDesign(designId)) {
            sendJson(res, 403, {
              ok: false,
              error: "pending read is not authorized for this design",
            });
            return;
          }
          pruneLiveEditPendingEntries(pendingVisualEditPayloads, Date.now());
          sendJson(res, 200, {
            ok: true,
            pending: pendingVisualEditPayloads.get(designId)?.pending ?? null,
          });
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        // credential must come from the custom header, not a query string or
        if (!explicitPreviewTokenValid) {
          sendJson(res, 401, {
            ok: false,
            error: "pending publication requires the preview token header",
          });
          return;
        }
        if (
          requestOrigin === "null" ||
          (!requestOrigin && crossSiteRequest) ||
          (requestOrigin && !corsApproved)
        ) {
          sendJson(res, 403, {
            ok: false,
            error: "origin is not allowed by this bridge",
          });
          return;
        }
        if (!isJsonRequest(req)) {
          sendJson(res, 415, {
            ok: false,
            error: "pending publication requires application/json",
          });
          return;
        }
        void (async () => {
          try {
            const raw = await readLiveEditPendingBody(req);
            const body = JSON.parse(raw) as Record<string, unknown>;
            const pending = body.pending;
            const pendingDesignId =
              pending && typeof pending === "object"
                ? (pending as Record<string, unknown>).designId
                : body.designId;
            if (
              typeof pendingDesignId !== "string" ||
              !isValidLiveEditCapability(req, pendingDesignId)
            ) {
              sendJson(res, 403, {
                ok: false,
                error:
                  "pending publication requires a design-scoped capability",
              });
              return;
            }
            if (!isRegisteredDesign(pendingDesignId)) {
              sendJson(res, 403, {
                ok: false,
                error: "pending publication is not authorized for this design",
              });
              return;
            }
            const revision = body.revision;
            const now = Date.now();
            pruneLiveEditPendingEntries(pendingVisualEditPayloads, now);
            const existing = pendingVisualEditPayloads.get(pendingDesignId);
            if (pending === null) {
              if (
                typeof revision !== "number" ||
                !Number.isSafeInteger(revision) ||
                revision < 1
              ) {
                sendJson(res, 400, {
                  ok: false,
                  error:
                    "pending publication requires a positive safe revision",
                });
                return;
              }
              const stored = await storePendingVisualEdit(
                pendingDesignId,
                revision,
                null,
                now,
              );
              if (stored !== "stored") {
                sendJson(res, stored === "capacity" ? 503 : 409, {
                  ok: false,
                  error:
                    stored === "capacity"
                      ? "The bridge has reached its retained design revision limit."
                      : stored === "stale"
                        ? "stale pending publication revision"
                        : "conflicting pending publication revision",
                  revision: existing?.revision,
                });
                return;
              }
              sendJson(res, 200, { ok: true, pending: null });
              return;
            }
            if (!pending || typeof pending !== "object") {
              sendJson(res, 400, {
                ok: false,
                error: "pending must be an object or null",
              });
              return;
            }
            const candidate = pending as Record<string, unknown>;
            if (
              typeof candidate.designId !== "string" ||
              typeof candidate.prompt !== "string" ||
              typeof candidate.pendingEditCount !== "number" ||
              !Number.isInteger(candidate.pendingEditCount) ||
              candidate.pendingEditCount < 1 ||
              typeof candidate.status !== "string"
            ) {
              sendJson(res, 400, {
                ok: false,
                error:
                  "pending requires designId, prompt, positive pendingEditCount, and status",
              });
              return;
            }
            if (candidate.prompt.length > MAX_LIVE_EDIT_PENDING_PROMPT_LENGTH) {
              sendJson(res, 413, {
                ok: false,
                error: "pending prompt exceeds the 64 KB limit",
              });
              return;
            }
            if (body.designId !== pendingDesignId) {
              sendJson(res, 400, {
                ok: false,
                error: "pending designId must match its envelope",
              });
              return;
            }
            if (
              typeof revision !== "number" ||
              !Number.isSafeInteger(revision) ||
              revision < 1
            ) {
              sendJson(res, 400, {
                ok: false,
                error: "pending publication requires a positive safe revision",
              });
              return;
            }
            const publishedPending = {
              designId: candidate.designId,
              pendingEditCount: candidate.pendingEditCount,
              status: candidate.status,
              prompt: candidate.prompt,
              updatedAt: new Date().toISOString(),
            };
            const stored = await storePendingVisualEdit(
              candidate.designId,
              revision,
              publishedPending,
              now,
            );
            if (stored !== "stored") {
              sendJson(res, stored === "capacity" ? 503 : 409, {
                ok: false,
                error:
                  stored === "capacity"
                    ? "The bridge has reached its retained design revision limit."
                    : stored === "stale"
                      ? "stale pending publication revision"
                      : "conflicting pending publication revision",
                revision: existing?.revision,
              });
              return;
            }
            sendJson(res, 200, { ok: true, pending: publishedPending });
          } catch (error) {
            sendJson(
              res,
              error instanceof LiveEditPendingRequestTooLargeError
                ? 413
                : error instanceof LiveEditRevisionPersistenceError
                  ? 500
                  : 400,
              {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        })();
        return;
      }
      if (pathname === "/live-edit") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        if (rejectInvalidPreviewToken()) return;
        void (async () => {
          try {
            const targetUrl = resolvePreviewSnapshotUrl(
              manifest.devServerUrl,
              requestUrl.searchParams.get("url") ??
                requestUrl.searchParams.get("path"),
            );
            const snapshot = await fetchPreviewSnapshot(
              manifest.devServerUrl,
              targetUrl,
              previewSessionCookies,
            );
            const includeEditorBridge =
              requestUrl.searchParams.get("bridge") !== "0";
            const requestedBridgeKey =
              requestUrl.searchParams.get("bridgeKey")?.trim() ?? "";
            const editorBridgeScript = requestedBridgeKey
              ? (liveEditBridgeScripts.get(requestedBridgeKey) ?? "")
              : liveEditBridgeScript;
            if (
              includeEditorBridge &&
              requestedBridgeKey &&
              !editorBridgeScript
            ) {
              sendJson(res, 409, {
                ok: false,
                code: "unknown-bridge-key",
                bridgeKey: requestedBridgeKey,
                bridgeInstanceId,
                error:
                  "The requested live-edit bridge script is not registered. Reload the Design frame to register it again.",
              });
              return;
            }
            const targetParsed = new URL(targetUrl);
            const targetSearch = requestedBridgeKey
              ? appendQueryPair(
                  stripQueryPair(targetParsed.search, FRAME_BRIDGE_KEY_PARAM),
                  FRAME_BRIDGE_KEY_PARAM,
                  requestedBridgeKey,
                )
              : targetParsed.search;
            const targetPath = `${targetParsed.pathname}${targetSearch}` || "/";
            const html = injectLiveEditBridge(
              snapshot.html,
              new URL("/", manifest.bridgeUrl).toString(),
              includeEditorBridge ? editorBridgeScript : "",
              targetPath,
              requestedBridgeKey
                ? { bridgeKey: requestedBridgeKey, previewToken }
                : { previewToken },
            );
            sendText(
              res,
              snapshot.status >= 400 ? snapshot.status : 200,
              html,
              snapshot.contentType.includes("html")
                ? snapshot.contentType
                : "text/html; charset=utf-8",
              [
                ...snapshot.setCookieHeaders,
                previewSessionSetCookie(previewToken),
              ],
              BRIDGE_FRAME_HEADERS,
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
        if (rejectInvalidPreviewToken()) return;
        void (async () => {
          try {
            const targetUrl = resolvePreviewSnapshotUrl(
              manifest.devServerUrl,
              requestUrl.searchParams.get("url") ??
                requestUrl.searchParams.get("path"),
            );
            const snapshot = await fetchPreviewSnapshot(
              manifest.devServerUrl,
              targetUrl,
              previewSessionCookies,
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

        const providedToken = readHeader(req, "x-bridge-token");
        const tokenValid = constantTimeTokenMatches(providedToken, bridgeToken);
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

            assertNotBlockedSecretPath(relPath);
            const initialTarget = await resolveSafeBridgeFileTarget(
              manifest.rootPath,
              relPath,
            );

            if (pathname === "/read-file") {
              const snapshot = await readBridgeFileSnapshot(
                initialTarget.absolutePath,
              );
              if (!snapshot) {
                sendJson(res, 404, { ok: false, error: "file not found" });
                return;
              }
              sendJson(res, 200, {
                ok: true,
                content: snapshot.content,
                versionHash: snapshot.versionHash,
              });
              return;
            }

            const expectedVersionHash =
              typeof body["expectedVersionHash"] === "string"
                ? body["expectedVersionHash"]
                : undefined;
            const requireExpectedVersionHash =
              body["requireExpectedVersionHash"] === true;
            await withBridgeWriteLock(initialTarget.canonicalPath, async () => {
              const lockedTarget = await resolveSafeBridgeFileTarget(
                manifest.rootPath,
                relPath,
              );
              if (lockedTarget.canonicalPath !== initialTarget.canonicalPath) {
                throw new Error(
                  "Bridge target changed while waiting for the write lock",
                );
              }
              const existing = await readBridgeFileSnapshot(
                lockedTarget.absolutePath,
              );
              assertEditableTextFile(relPath, existing);
              assertExpectedBridgeVersion(
                expectedVersionHash,
                existing?.versionHash,
                requireExpectedVersionHash,
              );

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
                const versionHash = await atomicWriteBridgeFile({
                  rootPath: manifest.rootPath,
                  relPath,
                  lockedCanonicalPath: initialTarget.canonicalPath,
                  content,
                  expectedVersionHash,
                  requireExpectedVersionHash,
                  originalMode: existing?.mode,
                });
                sendJson(res, 200, { ok: true, relPath, versionHash });
                return;
              }

              if (typeof body["content"] === "string") {
                const versionHash = await atomicWriteBridgeFile({
                  rootPath: manifest.rootPath,
                  relPath,
                  lockedCanonicalPath: initialTarget.canonicalPath,
                  content: body["content"],
                  expectedVersionHash,
                  requireExpectedVersionHash,
                  originalMode: existing?.mode,
                });
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
                typeof body["replace"] === "string"
                  ? body["replace"]
                  : undefined;
              if (search === undefined || replace === undefined) {
                sendJson(res, 400, {
                  ok: false,
                  error:
                    "apply-edit requires either {content} for a full replace, or {search, replace} for a patch",
                });
                return;
              }
              if (!existing) {
                sendJson(res, 404, {
                  ok: false,
                  error: "file not found — use write-file to create new files",
                });
                return;
              }
              if (search.length === 0) {
                sendJson(res, 400, {
                  ok: false,
                  error: "search string must not be empty",
                });
                return;
              }
              const occurrenceCount = countOccurrences(
                existing.content,
                search,
              );
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
              const updated = existing.content.replace(search, replace);
              const versionHash = await atomicWriteBridgeFile({
                rootPath: manifest.rootPath,
                relPath,
                lockedCanonicalPath: initialTarget.canonicalPath,
                content: updated,
                expectedVersionHash,
                requireExpectedVersionHash,
                originalMode: existing.mode,
              });
              sendJson(res, 200, {
                ok: true,
                relPath,
                method: "patch",
                versionHash,
              });
            });
          } catch (err: unknown) {
            if (err instanceof BridgePreconditionRequiredError) {
              sendJson(res, 428, {
                ok: false,
                error: "expectedVersionHash is required",
              });
              return;
            }
            if (err instanceof BridgeVersionConflictError) {
              sendJson(res, 409, {
                ok: false,
                error: "version conflict",
                currentVersionHash: err.currentVersionHash,
              });
              return;
            }
            sendJson(res, 500, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return;
      }

      if (
        req.method &&
        ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)
      ) {
        if (!previewTokenValid && !isProxiedAppManifestRequest) {
          sendJson(res, 401, {
            ok: false,
            error: "invalid or missing preview token",
          });
          return;
        }
        void (async () => {
          try {
            const proxyRequestUrl = new URL(req.url ?? "/", manifest.bridgeUrl);
            const targetUrl = resolvePreviewProxyUrl(
              manifest.devServerUrl,
              `${proxyRequestUrl.pathname}${stripQueryPair(
                stripPreviewTokenQueryParam(proxyRequestUrl.search),
                FRAME_BRIDGE_KEY_PARAM,
              )}`,
            );
            const method = req.method ?? "GET";
            const keyed = isFrameNavigationRequest(req)
              ? keyedFrameNavigation(
                  proxyRequestUrl,
                  readHeader(req, "referer"),
                  manifest.bridgeUrl,
                )
              : null;
            if (method === "GET" && keyed) {
              {
                const next = new URL("/live-edit", manifest.bridgeUrl);
                next.searchParams.set("url", targetUrl);
                next.searchParams.set("bridgeKey", keyed.bridgeKey);
                if (keyed.previewToken) {
                  next.searchParams.set("previewToken", keyed.previewToken);
                }
                res.writeHead(302, {
                  location: next.toString(),
                  ...BRIDGE_FRAME_HEADERS,
                  ...bridgeCorsHeaders(res),
                });
                res.end();
                return;
              }
            }
            const keyedScript = keyed
              ? liveEditBridgeScripts.get(keyed.bridgeKey)
              : undefined;
            if (keyed && !keyedScript) {
              req.resume();
              sendJson(res, 409, {
                ok: false,
                code: "unknown-bridge-key",
                bridgeKey: keyed.bridgeKey,
                bridgeInstanceId,
                error:
                  "The requested live-edit bridge script is not registered. Reload the Design frame to register it again.",
              });
              return;
            }
            const requestBody =
              method === "GET" || method === "HEAD"
                ? undefined
                : await readPreviewProxyRequestBody(req);
            const cookieHeader = previewSessionCookies.headerFor(targetUrl);
            const proxiedRequestHeaders = previewProxyRequestHeaders(
              req,
              manifest.devServerUrl,
              cookieHeader,
            );
            const proxied = await fetchPreviewProxyResource(
              manifest.devServerUrl,
              targetUrl,
              {
                method,
                headers: proxiedRequestHeaders,
                body: requestBody,
              },
              previewSessionCookies,
            );
            const contentType = proxied.headers.get("content-type") ?? "";
            const documentNavigation = isFrameNavigationRequest(req);
            const responseBody =
              documentNavigation && contentType.includes("html")
                ? Buffer.from(
                    injectLiveEditBridge(
                      proxied.body.toString("utf8"),
                      new URL("/", manifest.bridgeUrl).toString(),
                      keyedScript ??
                        (method !== "GET" && liveEditBridgeScripts.size > 0
                          ? ""
                          : liveEditBridgeScript),
                      (() => {
                        const parsed = new URL(proxied.url);
                        const search = stripQueryPair(
                          parsed.search,
                          FRAME_BRIDGE_KEY_PARAM,
                        );
                        return (
                          `${parsed.pathname}${
                            keyed
                              ? appendQueryPair(
                                  search,
                                  FRAME_BRIDGE_KEY_PARAM,
                                  keyed.bridgeKey,
                                )
                              : search
                          }` || "/"
                        );
                      })(),
                      keyed
                        ? { bridgeKey: keyed.bridgeKey, previewToken }
                        : method === "GET"
                          ? { recoverTargetUrl: targetUrl, previewToken }
                          : { previewToken },
                    ),
                  )
                : proxied.body;
            const headStylesheetProbe =
              method === "HEAD" &&
              previewTokenValid &&
              (contentType.includes("text/css") ||
                contentType.includes("javascript"))
                ? await fetchPreviewProxyResource(
                    manifest.devServerUrl,
                    targetUrl,
                    { method: "GET", headers: proxiedRequestHeaders },
                    previewSessionCookies,
                  )
                : undefined;
            const resourceBody = headStylesheetProbe?.body ?? responseBody;
            const responseText = resourceBody.toString("utf8");
            const opaqueFrameStylesheet =
              contentType.includes("text/css") ||
              (contentType.includes("javascript") &&
                responseText.includes("__vite__css"));
            const opaqueFrameJavaScript = contentType.includes("javascript");
            const shouldRewriteOpaqueFrameResources =
              previewTokenValid &&
              (opaqueFrameStylesheet || opaqueFrameJavaScript);
            const rewrittenResourceText = opaqueFrameJavaScript
              ? addOpaqueFrameJavaScriptResourceTokens(
                  responseText,
                  previewToken,
                )
              : responseText;
            const opaqueFrameResponseBody = shouldRewriteOpaqueFrameResources
              ? Buffer.from(
                  opaqueFrameStylesheet
                    ? addOpaqueFrameResourceTokens(
                        rewrittenResourceText,
                        previewToken,
                      )
                    : rewrittenResourceText,
                )
              : responseBody;
            const advertisedContentLength =
              method === "HEAD" && !shouldRewriteOpaqueFrameResources
                ? Number(proxied.headers.get("content-length")) || 0
                : opaqueFrameResponseBody.length;
            sendBytes(
              res,
              proxied.status,
              method === "HEAD" ? Buffer.alloc(0) : opaqueFrameResponseBody,
              proxied.headers,
              advertisedContentLength,
              proxied.setCookieHeaders,
              documentNavigation && contentType.includes("html")
                ? BRIDGE_FRAME_HEADERS
                : {},
              shouldRewriteOpaqueFrameResources,
            );
          } catch (err: unknown) {
            sendJson(
              res,
              err instanceof PreviewProxyRequestTooLargeError ? 413 : 400,
              {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        })();
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    },
  );

  server.on("upgrade", (req, clientSocket, clientHead) => {
    clientSocket.on("error", () => clientSocket.destroy());
    const requestUrl = new URL(req.url ?? "/", manifest.bridgeUrl);
    const providedPreviewToken =
      readHeader(req, "x-design-preview-token") ||
      requestUrl.searchParams.get("previewToken") ||
      readRequestCookie(req, PREVIEW_SESSION_COOKIE_NAME) ||
      "";
    const browserOrigin = readHeader(req, "origin");
    const sameBridgeOrigin =
      browserOrigin === new URL(manifest.bridgeUrl).origin;
    if (!constantTimeTokenMatches(providedPreviewToken, previewToken)) {
      clientSocket.end(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    let targetUrl: URL;
    try {
      targetUrl = new URL(
        resolvePreviewProxyUrl(
          manifest.devServerUrl,
          `${requestUrl.pathname}${stripPreviewTokenQueryParam(requestUrl.search)}`,
        ),
      );
    } catch {
      clientSocket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }

    const upstreamHeaders = { ...req.headers };
    delete upstreamHeaders["x-bridge-token"];
    delete upstreamHeaders["x-design-preview-token"];
    delete upstreamHeaders["x-agent-native-live-edit-capability"];
    delete upstreamHeaders["authorization"];
    delete upstreamHeaders["cookie"];
    upstreamHeaders.host = targetUrl.host;
    upstreamHeaders.origin = new URL(manifest.devServerUrl).origin;
    const cookie = mergePreviewCookieHeaders(
      previewSessionCookies.headerFor(targetUrl.toString()),
      sameBridgeOrigin ? readHeader(req, "cookie") : "",
    );
    if (cookie) upstreamHeaders.cookie = cookie;

    const requestImpl = targetUrl.protocol === "https:" ? https : http;
    let upgraded = false;
    const upstreamRequest = requestImpl.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: "GET",
      headers: upstreamHeaders,
    });
    clientSocket.once("close", () => {
      if (!upgraded) upstreamRequest.destroy();
    });
    upstreamRequest.on(
      "upgrade",
      (upstreamResponse, upstreamSocket, upstreamHead) => {
        upgraded = true;
        const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage || "Switching Protocols"}\r\n`;
        const headerLines: string[] = [];
        for (
          let index = 0;
          index < upstreamResponse.rawHeaders.length;
          index += 2
        ) {
          const name = upstreamResponse.rawHeaders[index];
          const value = upstreamResponse.rawHeaders[index + 1];
          if (name && value !== undefined)
            headerLines.push(`${name}: ${value}`);
        }
        clientSocket.write(`${statusLine}${headerLines.join("\r\n")}\r\n\r\n`);
        if (clientHead.length > 0) upstreamSocket.write(clientHead);
        if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
        upstreamSocket.on("error", () => upstreamSocket.destroy());
        clientSocket.once("close", () => upstreamSocket.destroy());
        upstreamSocket.once("close", () => clientSocket.destroy());
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );
    upstreamRequest.on("response", (upstreamResponse) => {
      clientSocket.end(
        `HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage || "WebSocket upgrade failed"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      upstreamResponse.resume();
    });
    upstreamRequest.on("error", () => {
      if (!clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
      }
    });
    upstreamRequest.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(new URL(manifest.bridgeUrl).port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (options.persistBridgeToken !== false) {
    try {
      await persistBridgeToken(manifest.rootPath, bridgeToken);
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  return { server, manifest, bridgeToken, previewToken, bridgeInstanceId };
}

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
  const { manifest, bridgeToken, previewToken } = bridge;
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
    // minting its own unrelated token, which would always produce a 401.
    bridgeToken,
    previewToken,
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
  agent-native design pending [options]

Options:
  --url <url>             Dev server URL to inspect (auto-detected if omitted)
  --port <number>         Local bridge port (default ${DEFAULT_BRIDGE_PORT})
  --root <path>           App/repo root for route discovery (default cwd)
  --route-manifest <path> Non-destructive route manifest output path
  --app-url <url>         Deployed design app URL for self-registration
                          (also reads AGENT_NATIVE_URL / DESIGN_APP_URL env)
  --bridge-token <token>  Adopt a bridge token minted server-side by the
                          authenticated connect-localhost / open-visual-edit
                          action instead of minting one. Used by the remote-MCP
                          /visual-edit flow so the bridge and the user's stored
                          connection token match with no self-registration.
                          (also reads AGENT_NATIVE_BRIDGE_TOKEN env)
  --preview-token <token> Adopt the paired read-only browser preview token.
                          Optional when --bridge-token is present: compatible
                          clients derive the same one-way token automatically.
                          (stale AGENT_NATIVE_PREVIEW_TOKEN values are ignored)
  --daemon                Start the bridge detached, wait for /health, then exit
  --json                  Print the manifest JSON and exit
  --once                  Prepare/scaffold the manifest and exit
  --dry-run               Print what would be exposed without writing files

Pending visual edits:
  --bridge-url <url>      Paired local bridge URL (default http://127.0.0.1:${DEFAULT_BRIDGE_PORT})
  --root <path>           App/repo root containing .agent-native/design-bridge-token
  --design-id <id>        Design ID whose pending visual edits to retrieve
  --preview-token <token> Read-only preview token when the root token is unavailable

Element provenance (resolveNodeToFile):
  The design editor can map a selected DOM element back to its source file,
  line, and component name using one of these provenance sources:

  • React development builds with jsxDEV enabled (the default):
      Design reads the selected element's development-only Fiber debug stack.
      React does not emit data-source-* DOM attributes automatically.

  • A Babel source plugin (e.g. babel-plugin-react-source or a custom plugin):
      Emits data-source-file="src/Button.tsx" data-source-line="12"
      data-source-column="4" data-component-name="Button" on each element.

  • data-loc="src/Button.tsx:12:4" shorthand attribute (Babel source convention):
      The bridge parses this as { sourceFile, line, column } automatically.

  In production React builds and other runtimes without explicit attributes,
  the editor still works but exact element provenance may be absent.
  Cross-origin localhost iframes cannot be read regardless of attributes (CSP).`);
}

function removeDaemonFlag(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--daemon");
}

function resolveCurrentCliInvocation(argv: string[]): {
  command: string;
  args: string[];
} {
  const suffixLength = argv.length + 1;
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
  bridgeToken: string,
): Promise<number> {
  if (await waitForBridgeHealth(manifest.bridgeUrl, 800)) {
    const manifestResult = await inspectRunningBridge(manifest, bridgeToken);
    const runningManifest = manifestResult.manifest;
    const { fingerprintMatches } = manifestResult;
    if (
      runningManifest &&
      designConnectManifestsTargetSameApp(runningManifest, manifest)
    ) {
      await persistBridgeToken(manifest.rootPath, bridgeToken);
      console.error(
        `Design localhost bridge already running at ${manifest.bridgeUrl}`,
      );
      console.log(JSON.stringify(runningManifest, null, 2));
      return 0;
    }

    if (fingerprintMatches && !runningManifest) {
      const errorMessage =
        manifestResult.status === 401
          ? "A Design localhost bridge for this app is already running, but it rejected the current bridge token (HTTP 401)."
          : "A Design localhost bridge for this app is already running, but its authenticated manifest could not be verified.";
      console.error(
        [
          errorMessage,
          ...(manifestResult.status === 401
            ? [
                "If the token changed, stop only the bridge process you started, then rerun design connect with the bridgeToken returned by open-visual-edit via --bridge-token (or AGENT_NATIVE_BRIDGE_TOKEN).",
              ]
            : ["Retry after confirming the bridge is healthy."]),
          "The existing process was left running.",
        ].join("\n"),
      );
      return 1;
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
  const logPath = await createDaemonLogPath(manifest.rootPath);
  const logFd = await fs.open(logPath, "a");
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      AGENT_NATIVE_BRIDGE_TOKEN: bridgeToken,
    },
    stdio: ["ignore", logFd.fd, logFd.fd],
    shell: process.platform === "win32",
  });
  child.unref();

  if (await waitForBridgeHealth(manifest.bridgeUrl)) {
    const running = await inspectRunningBridge(manifest, bridgeToken);
    if (
      running.manifest &&
      designConnectManifestsTargetSameApp(running.manifest, manifest)
    ) {
      await persistBridgeToken(manifest.rootPath, bridgeToken);
      await logFd.close();
      console.error(`Design localhost bridge running at ${manifest.bridgeUrl}`);
      console.error(`Bridge log: ${logPath}`);
      console.log(JSON.stringify(running.manifest, null, 2));
      return 0;
    }

    await logFd.close();
    const authenticationFailed =
      running.fingerprintMatches && !running.manifest;
    console.error(
      [
        authenticationFailed
          ? `A Design localhost bridge for this app became available at ${manifest.bridgeUrl}, but it rejected this invocation's bridge token (HTTP ${running.status ?? "unknown"}).`
          : `A Design localhost bridge became available at ${manifest.bridgeUrl} for a different app or could not be verified.`,
        "No bridge token was persisted; the running process was left untouched.",
        `Bridge log: ${logPath}`,
      ].join("\n"),
    );
    return 1;
  }

  const tail = await readDaemonLogTail(logPath);
  await logFd.close();
  console.error(
    [
      `Timed out waiting for detached Design bridge at ${manifest.bridgeUrl}`,
      `Bridge log: ${logPath}`,
      tail ? `Last output:\n${tail}` : "The bridge produced no output.",
    ].join("\n"),
  );
  return 1;
}

async function createDaemonLogPath(rootPath: string): Promise<string> {
  const dir = path.join(rootPath, ".agent-native");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "design-connect.log");
}

async function readDaemonLogTail(
  logPath: string,
  maxBytes = 4000,
): Promise<string> {
  try {
    const contents = await fs.readFile(logPath, "utf8");
    return contents.slice(-maxBytes).trim();
  } catch {
    return "";
  }
}

export async function runDesign(argv: string[]) {
  const subcommand = argv[0];
  if (subcommand === "pending") {
    const readFlag = (name: string): string | undefined => {
      const index = argv.indexOf(name);
      const value = index >= 0 ? argv[index + 1] : undefined;
      return value && !value.startsWith("--") ? value : undefined;
    };
    const root = path.resolve(readFlag("--root") ?? process.cwd());
    const bridgeUrl = (
      readFlag("--bridge-url") ?? `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`
    ).replace(/\/$/, "");
    const designId = readFlag("--design-id")?.trim();
    if (!designId) {
      console.error(
        "Pass --design-id to select the visual-edit handoff to retrieve.",
      );
      return 1;
    }
    const bridgeToken = await readPersistedBridgeToken(root);
    const previewTokenOverride = readFlag("--preview-token");
    const token =
      previewTokenOverride ??
      (bridgeToken ? deriveDesignPreviewToken(bridgeToken) : undefined);
    if (!token || !bridgeToken) {
      console.error(
        "The design-scoped live-edit credential is unavailable. Run design connect from the connected app root before reading pending edits.",
      );
      return 1;
    }
    const pendingUrl = new URL(`${bridgeUrl}/live-edit-pending`);
    pendingUrl.searchParams.set("designId", designId);
    const response = await fetch(pendingUrl, {
      headers: {
        "x-design-preview-token": token,
        "x-agent-native-live-edit-capability":
          deriveDesignScopedLiveEditCapability(bridgeToken, designId),
      },
    });
    if (!response.ok) {
      console.error(`${response.status} ${await response.text()}`);
      return 1;
    }
    const body = (await response.json()) as { pending?: unknown };
    console.log(JSON.stringify(body.pending ?? null, null, 2));
    return 0;
  }
  if (subcommand !== "connect") {
    if (
      subcommand === "help" ||
      subcommand === "--help" ||
      subcommand === "-h"
    ) {
      printHelp();
      return 0;
    }
    console.error(
      "Usage: agent-native design connect [options] | agent-native design pending [options]",
    );
    return 1;
  }

  const parsed = parseDesignConnectArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }

  const manifest = await prepareDesignConnectManifest(parsed);
  const seedBridgeToken =
    parsed.bridgeToken || process.env["AGENT_NATIVE_BRIDGE_TOKEN"] || undefined;
  const seedPreviewToken =
    parsed.previewToken ||
    (seedBridgeToken ? deriveDesignPreviewToken(seedBridgeToken) : undefined);
  const appUrl = resolveAppUrl(parsed.appUrl);
  if (parsed.daemon) {
    const bridgeToken = await resolveBridgeToken(
      manifest.rootPath,
      seedBridgeToken,
      false,
    );
    const derivedPreviewToken = deriveDesignPreviewToken(bridgeToken);
    if (parsed.previewToken && parsed.previewToken !== derivedPreviewToken) {
      throw new Error(
        "previewToken must match the deterministic token derived from bridgeToken",
      );
    }
    if (
      process.env["AGENT_NATIVE_PREVIEW_TOKEN"] &&
      process.env["AGENT_NATIVE_PREVIEW_TOKEN"] !== derivedPreviewToken
    ) {
      console.warn(
        "Ignoring stale AGENT_NATIVE_PREVIEW_TOKEN; the current bridge token determines the preview token.",
      );
    }
    return startDetachedDesignBridge(argv, manifest, bridgeToken);
  }
  if (parsed.json || parsed.once || parsed.dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }

  const bridge = await startDesignConnectBridge(manifest, {
    bridgeToken: seedBridgeToken,
    previewToken: seedPreviewToken,
    allowedOrigins: appUrl ? [appUrl] : [],
  });
  console.error("Design localhost bridge running");
  console.error(`Bridge:   ${manifest.bridgeUrl}`);
  console.error(`Manifest: ${manifest.bridgeUrl}/manifest.json`);
  console.error(`Routes:   ${manifest.routeCount}`);
  console.error(`Dev URL:  ${manifest.devServerUrl}`);

  if (appUrl) {
    await registerConnectionWithServer(appUrl, bridge, resolveAuthToken());
  } else if (!seedBridgeToken) {
    // No token source at all — warn rather than 401 silently at edit time.
    console.error(
      "[design connect] No bridge token or app URL resolved (pass --bridge-token, or --app-url / AGENT_NATIVE_URL); skipping self-registration — browser preview and live-edit will fail to authorize.",
    );
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
