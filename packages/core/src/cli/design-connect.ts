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
] as const;

type BridgeOperation = (typeof BRIDGE_OPERATIONS)[number];

export interface DesignConnectArgs {
  url?: string;
  port: number;
  root: string;
  routeManifest?: string;
  json: boolean;
  once: boolean;
  dryRun: boolean;
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
}

export interface DesignConnectBridge {
  server: Server;
  manifest: DesignConnectManifest;
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
    } else if (arg === "--json") {
      parsed.json = true;
      parsed.once = true;
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
      parsed.once = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive integer");
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
    capabilities: BRIDGE_OPERATIONS.map((operation) => ({
      operation,
      status:
        operation === "readFile" ||
        operation === "applyEdit" ||
        operation === "writeFile"
          ? "planned"
          : "available",
      reason:
        operation === "writeFile"
          ? "The bridge advertises the contract before enabling local file writes."
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

export async function startDesignConnectBridge(
  manifest: DesignConnectManifest,
): Promise<DesignConnectBridge> {
  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }
      const pathname = new URL(req.url ?? "/", manifest.bridgeUrl).pathname;
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

  return { server, manifest };
}

function printHelp() {
  console.log(`Usage:
  agent-native design connect [options]

Options:
  --url <url>             Dev server URL to inspect (auto-detected if omitted)
  --port <number>         Local bridge port (default ${DEFAULT_BRIDGE_PORT})
  --root <path>           App/repo root for route discovery (default cwd)
  --route-manifest <path> Non-destructive route manifest output path
  --json                  Print the manifest JSON and exit
  --once                  Prepare/scaffold the manifest and exit
  --dry-run               Print what would be exposed without writing files`);
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

  return await new Promise<number>((resolve) => {
    const stop = () => {
      bridge.server.close(() => resolve(0));
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.once(signal, stop);
    }
  });
}
