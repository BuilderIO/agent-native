#!/usr/bin/env node

/**
 * Post-build step for deploying agent-native apps to edge/serverless targets.
 *
 * When NITRO_PRESET is set, this script:
 * 1. Takes the React Router build output (build/client/ + build/server/)
 * 2. Generates a platform-specific server entry point
 * 3. Bundles everything with esbuild into the target format
 *
 * Supported presets:
 * - cloudflare_pages: Outputs dist/ with _worker.js for Cloudflare Pages
 * - cloudflare_module: Outputs a native Cloudflare Worker under .output/server
 *
 * Usage: node deploy/build.js (called automatically by `agent-native build`)
 */

import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import {
  AGENT_BACKGROUND_FUNCTION_NAME,
  AGENT_BACKGROUND_FUNCTION_URL_PATH,
  AGENT_BACKGROUND_PROCESSOR_A2A,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_INTEGRATION,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
  isDurableBackgroundFlagExplicitlyDisabled,
} from "../agent/durable-background.js";
import {
  INTEGRATION_RECOVERY_RUNTIME_MARKER,
  INTEGRATION_RETRY_SWEEP_PATH,
  INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT,
  isIntegrationDurableDispatchConfigured,
} from "../integrations/integration-durable-dispatch-config.js";
import { isValidCron } from "../jobs/cron.js";
import {
  RECURRING_JOBS_SWEEP_PATH,
  RECURRING_JOBS_SWEEP_TOKEN_SUBJECT,
} from "../jobs/scheduler-dispatch.js";
import { normalizeAppBasePath } from "../server/app-base-path.js";
import {
  DEFAULT_SPECULATION_RULES_PATH,
  resolveSsrCacheHeaders,
  resolveSsrCacheKeyHeaders,
  SSR_QUERY_CACHE_KEY_HEADER,
} from "../shared/cache-control.js";
import { mcpEmbedStaticAssetRouteRules } from "../shared/mcp-embed-headers.js";
import { isTruthyRuntimeValue } from "../shared/runtime-config.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
} from "../shared/social-meta.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";
import { cloneServerBundleForFunction, copyDir } from "./function-bundle.js";
import {
  collectImmutableAssetPaths,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  IMMUTABLE_ASSET_CACHE_HEADERS,
  prefixAssetPath,
} from "./immutable-assets.js";
import {
  discoverApiRoutes,
  discoverPlugins,
  discoverActionFiles,
  getMissingDefaultPlugins,
  DEFAULT_PLUGIN_REGISTRY,
  type DiscoveredRoute,
  type DiscoveredAction,
} from "./route-discovery.js";
import {
  getWorkspaceCoreExports,
  type WorkspaceCoreExports,
} from "./workspace-core.js";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";
export const CLOUDFLARE_MODULE_PRESETS = [
  "cloudflare_module",
  "cloudflare-module",
] as const;

export function isCloudflareModulePreset(targetPreset: string): boolean {
  return (CLOUDFLARE_MODULE_PRESETS as readonly string[]).includes(
    targetPreset,
  );
}

export const CLOUDFLARE_MODULE_WORKER_ENTRY = "worker.mjs";

export function generateCloudflareModuleWorkerEntry(): string {
  return `let handler;

export * from "./index.mjs";

async function loadHandler() {
  handler ??= (await import("./index.mjs")).default;
  return handler;
}

function initializeBindings(env) {
  if (!env) return;
  globalThis.__cf_env = env;
  globalThis.__env__ = env;
  globalThis.process = globalThis.process || { env: {} };
  globalThis.process.env = globalThis.process.env || {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") globalThis.process.env[key] = value;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (typeof ctx?.waitUntil === "function") {
      request.waitUntil = ctx.waitUntil.bind(ctx);
    }
    initializeBindings(env);
    return (await loadHandler()).fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    initializeBindings(env);
    return (await loadHandler()).scheduled?.(controller, env, ctx);
  },
  async email(message, env, ctx) {
    initializeBindings(env);
    return (await loadHandler()).email?.(message, env, ctx);
  },
  async queue(batch, env, ctx) {
    initializeBindings(env);
    return (await loadHandler()).queue?.(batch, env, ctx);
  },
  async tail(traces, env, ctx) {
    initializeBindings(env);
    return (await loadHandler()).tail?.(traces, env, ctx);
  },
  async trace(traces, env, ctx) {
    initializeBindings(env);
    return (await loadHandler()).trace?.(traces, env, ctx);
  },
};
`;
}

export function patchCloudflareModuleNitroEntry(code: string): string {
  const factoryMatch = code.match(
    /function ([A-Za-z_$][\w$]*)\(e\)\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\),([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\);return\{async fetch\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\)\{/,
  );
  if (!factoryMatch) {
    throw new Error(
      "[deploy] Could not find Nitro's Cloudflare module handler factory",
    );
  }

  const [
    ,
    factoryName,
    handlerName,
    handlerFactoryName,
    hooksName,
    hooksFactoryName,
    requestName,
    envName,
    contextName,
  ] = factoryMatch;
  const eagerInitialization = `let ${handlerName}=${handlerFactoryName}(),${hooksName}=${hooksFactoryName}();`;
  if (!code.includes(eagerInitialization)) {
    throw new Error(
      `[deploy] Nitro's ${factoryName} handler changed its initialization shape`,
    );
  }

  const bindingMatch = code.match(
    new RegExp(
      `globalThis\\.__env__=${envName},([A-Za-z_$][\\w$]*)\\(${requestName},\\{env:${envName},context:${contextName}\\}\\);?`,
    ),
  );
  if (!bindingMatch) {
    throw new Error(
      `[deploy] Nitro's ${factoryName} handler does not initialize Cloudflare bindings as expected`,
    );
  }
  const bindingInitialization = bindingMatch[0];

  let patched = code.replace(
    eagerInitialization,
    `let ${handlerName},${hooksName};`,
  );
  patched = patched.replace(
    bindingInitialization,
    `${bindingInitialization}${handlerName}??=${handlerFactoryName}();`,
  );
  const hookCall = `${hooksName}.callHook(`;
  if (!patched.includes(hookCall)) {
    throw new Error(
      `[deploy] Nitro's ${factoryName} handler has no Cloudflare lifecycle hooks`,
    );
  }
  patched = patched
    .split(hookCall)
    .join(`(${hooksName}??=${hooksFactoryName}()).callHook(`);

  return patched;
}

export function configureCloudflareModuleWorkerOutput(serverDir: string): void {
  const configPath = path.join(serverDir, "wrangler.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `[deploy] Nitro did not generate ${configPath} for cloudflare_module`,
    );
  }
  const nitroEntryPath = path.join(serverDir, "index.mjs");
  if (!fs.existsSync(nitroEntryPath)) {
    throw new Error(
      `[deploy] Nitro did not generate ${nitroEntryPath} for cloudflare_module`,
    );
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    main?: string;
    compatibility_flags?: unknown;
    [key: string]: unknown;
  };
  config.main = CLOUDFLARE_MODULE_WORKER_ENTRY;
  const compatibilityFlags = Array.isArray(config.compatibility_flags)
    ? config.compatibility_flags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];
  config.compatibility_flags = [
    ...new Set([...compatibilityFlags, "nodejs_compat"]),
  ];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(
    nitroEntryPath,
    patchCloudflareModuleNitroEntry(fs.readFileSync(nitroEntryPath, "utf8")),
  );
  fs.writeFileSync(
    path.join(serverDir, CLOUDFLARE_MODULE_WORKER_ENTRY),
    generateCloudflareModuleWorkerEntry(),
  );
}
export const NITRO_RUNTIME_IGNORE_PATTERNS = [
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.mts",
  "**/*.spec.cts",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*.spec.mjs",
  "**/*.spec.cjs",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.mts",
  "**/*.test.cts",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.test.mjs",
  "**/*.test.cjs",
];

export const CLOUDFLARE_WORKER_ESBUILD_EXTERNALS = [
  "mermaid",
  "@excalidraw/excalidraw",
  "@excalidraw/mermaid-to-excalidraw",
  "pdf-parse",
  "pdfjs-dist",
  "@google/genai",
  "chartjs-node-canvas",
  "@napi-rs/canvas",
  "@anthropic-ai/tokenizer",
  "@resvg/resvg-js",
  "playwright",
  "playwright-core",
  "chromium-bidi",
  "chromium-bidi/*",
  "@sparticuz/chromium-min",
  "fsevents",
];
export const CLOUDFLARE_WORKER_STUB_MODULES: Record<string, string> = {
  "better-sqlite3":
    "export default {}; export const Database = class {}; export const watch = () => ({ close() {} });\n",
  "node-pty":
    "export default {}; export const watch = () => ({ close() {} });\n",
  chokidar: "export default {}; export const watch = () => ({ close() {} });\n",
  fsevents: "export default {}; export const watch = () => ({ close() {} });\n",
  dotenv: "export default {}; export const config = () => ({ parsed: {} });\n",
  "@anthropic-ai/sdk": "export default class Anthropic {}\n",
  "@anthropic-ai/tokenizer":
    "export default {}; export const countTokens = undefined;\n",
  "@sentry/node": [
    "export const init = () => {};",
    "const scope = {",
    "  setUser() {},",
    "  setTag() {},",
    "  setExtra() {},",
    "  setContext() {},",
    "  setLevel() {},",
    "  getScopeData() { return {}; },",
    "};",
    "export const getIsolationScope = () => scope;",
    "export const withScope = (fn) => fn(scope);",
    "export const captureException = () => undefined;",
    "export default { init, getIsolationScope, withScope, captureException };",
    "",
  ].join("\n"),
  "@resvg/resvg-js": [
    "export class Resvg {",
    '  constructor() { throw new Error("@resvg/resvg-js unavailable in Cloudflare Pages worker"); }',
    "}",
    "export default { Resvg };",
    "",
  ].join("\n"),
  playwright: [
    "const unavailable = async () => { throw new Error('playwright unavailable in Cloudflare Pages worker'); };",
    "export const chromium = { launch: unavailable, connect: unavailable, connectOverCDP: unavailable };",
    "export const firefox = { launch: unavailable, connect: unavailable };",
    "export const webkit = { launch: unavailable, connect: unavailable };",
    "export default { chromium, firefox, webkit };",
    "",
  ].join("\n"),
  "playwright-core": [
    "const unavailable = async () => { throw new Error('playwright-core unavailable in Cloudflare Pages worker'); };",
    "export const chromium = { launch: unavailable };",
    "export const firefox = { launch: unavailable };",
    "export const webkit = { launch: unavailable };",
    "export default { chromium, firefox, webkit };",
    "",
  ].join("\n"),
  "@sparticuz/chromium-min": [
    "const chromium = {",
    "  args: [],",
    "  setGraphicsMode: false,",
    "  executablePath: async () => { throw new Error('@sparticuz/chromium-min unavailable in Cloudflare Pages worker'); },",
    "};",
    "export default chromium;",
    "",
  ].join("\n"),
  "@google/genai": [
    "export class GoogleGenAI {",
    "  constructor() { throw new Error('@google/genai unavailable in Cloudflare Pages worker'); }",
    "}",
    "export default { GoogleGenAI };",
    "",
  ].join("\n"),
  "pdf-parse": [
    "export class PDFParse {",
    "  constructor() { throw new Error('pdf-parse unavailable in Cloudflare Pages worker'); }",
    "}",
    "export default { PDFParse };",
    "",
  ].join("\n"),
  "pdfjs-dist":
    "export default {}; export const getDocument = () => { throw new Error('pdfjs-dist unavailable in Cloudflare Pages worker'); };\n",
  "chartjs-node-canvas": [
    "export class ChartJSNodeCanvas {",
    "  constructor() { throw new Error('chartjs-node-canvas unavailable in Cloudflare Pages worker'); }",
    "}",
    "export default { ChartJSNodeCanvas };",
    "",
  ].join("\n"),
  "@napi-rs/canvas":
    "export default {}; export const createCanvas = () => { throw new Error('@napi-rs/canvas unavailable in Cloudflare Pages worker'); };\n",
  mermaid: "export default {}; export const mermaidAPI = {};\n",
  "@excalidraw/excalidraw":
    "export default {}; export const MainMenu = {}; export const WelcomeScreen = {};\n",
  "@excalidraw/mermaid-to-excalidraw":
    "export default async () => ({ elements: [], files: {} });\n",
};

export const CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES: Record<string, string> = {
  "pdf-parse/worker": [
    "const unavailable = async () => { throw new Error('pdf-parse/worker unavailable in Cloudflare Pages worker'); };",
    "export class CanvasFactory {}",
    "export const getData = unavailable;",
    "export default { CanvasFactory, getData };",
    "",
  ].join("\n"),
  "pdfjs-dist/legacy/build/pdf.mjs": [
    "const unavailable = () => { throw new Error('pdfjs-dist unavailable in Cloudflare Pages worker'); };",
    "export const OPS = new Proxy({}, { get: unavailable });",
    "export const Util = new Proxy({}, { get: unavailable });",
    "export const getDocument = unavailable;",
    "export default { OPS, Util, getDocument };",
    "",
  ].join("\n"),
};

export function cloudflareWorkerStubAliasArgs(stubDir: string): string[] {
  const subpathAliases = Object.keys(CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES)
    .sort((a, b) => b.length - a.length)
    .map(
      (mod) =>
        `--alias:${mod}=${path.join(stubDir, `${mod.replace(/\//g, "__")}.js`)}`,
    );
  const packageAliases = Object.keys(CLOUDFLARE_WORKER_STUB_MODULES)
    .sort((a, b) => b.length - a.length)
    .map((mod) => `--alias:${mod}=${path.join(stubDir, mod, "index.js")}`);
  return [...subpathAliases, ...packageAliases];
}

export function assertNoCloudflareWorkerStubDynamicImports(
  code: string,
  sourceName: string,
): void {
  const stubbedModules = [
    ...Object.keys(CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES),
    ...Object.keys(CLOUDFLARE_WORKER_STUB_MODULES),
  ];
  const pattern = stubbedModules
    .sort((a, b) => b.length - a.length)
    .map((moduleName) => moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const unresolvedImport = code.match(
    new RegExp(`\\bimport\\s*\\(\\s*(["'])(${pattern})\\1\\s*\\)`),
  );
  if (!unresolvedImport) return;
  throw new Error(
    `Cloudflare worker output ${sourceName} retained a dynamic import for stubbed module "${unresolvedImport[2]}". Use a literal import so the worker bundler can apply its fail-closed stub.`,
  );
}

function cloudflareNodeBuiltinStubSource(
  moduleName: string,
  namedExports: string[],
  overrides: string[] = [],
): string {
  const overridden = new Set(
    overrides.flatMap((source) =>
      Array.from(source.matchAll(/\bexport const ([A-Za-z_$][\w$]*)/g)).map(
        (match) => match[1],
      ),
    ),
  );
  const exports = Array.from(new Set(namedExports))
    .filter((name) => !overridden.has(name))
    .sort();
  return [
    `const unavailable = (name) => (..._args) => { throw new Error(name + " is unavailable in Cloudflare Pages workers"); };`,
    `const proxy = new Proxy({}, { get(_target, prop) { return unavailable("${moduleName}." + String(prop)); } });`,
    ...overrides,
    ...exports.map(
      (name) => `export const ${name} = unavailable("${moduleName}.${name}");`,
    ),
    "export default proxy;",
    "",
  ].join("\n");
}

export const CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES: Record<
  string,
  string
> = {
  child_process: cloudflareNodeBuiltinStubSource("child_process", [
    "exec",
    "execFile",
    "execFileSync",
    "execSync",
    "fork",
    "spawn",
    "spawnSync",
  ]),
  cluster: cloudflareNodeBuiltinStubSource("cluster", [
    "disconnect",
    "fork",
    "isMaster",
    "isPrimary",
    "isWorker",
    "setupMaster",
    "setupPrimary",
    "worker",
    "workers",
  ]),
  console: [
    "const globalConsole = globalThis.console;",
    "const bind = (name) => typeof globalConsole?.[name] === 'function' ? globalConsole[name].bind(globalConsole) : () => undefined;",
    "export class Console {",
    "  constructor() { return globalConsole; }",
    "}",
    "export const assert = bind('assert');",
    "export const clear = bind('clear');",
    "export const count = bind('count');",
    "export const countReset = bind('countReset');",
    "export const debug = bind('debug');",
    "export const dir = bind('dir');",
    "export const dirxml = bind('dirxml');",
    "export const error = bind('error');",
    "export const group = bind('group');",
    "export const groupCollapsed = bind('groupCollapsed');",
    "export const groupEnd = bind('groupEnd');",
    "export const info = bind('info');",
    "export const log = bind('log');",
    "export const profile = bind('profile');",
    "export const profileEnd = bind('profileEnd');",
    "export const table = bind('table');",
    "export const time = bind('time');",
    "export const timeEnd = bind('timeEnd');",
    "export const timeLog = bind('timeLog');",
    "export const timeStamp = bind('timeStamp');",
    "export const trace = bind('trace');",
    "export const warn = bind('warn');",
    "export { globalConsole as console };",
    "export default globalConsole;",
    "",
  ].join("\n"),
  dgram: cloudflareNodeBuiltinStubSource("dgram", ["createSocket"]),
  dns: cloudflareNodeBuiltinStubSource("dns", [
    "lookup",
    "promises",
    "resolve",
    "resolve4",
    "resolve6",
  ]),
  "dns/promises": cloudflareNodeBuiltinStubSource("dns/promises", [
    "lookup",
    "resolve",
    "resolve4",
    "resolve6",
  ]),
  domain: cloudflareNodeBuiltinStubSource("domain", ["create"]),
  fs: cloudflareNodeBuiltinStubSource(
    "fs",
    [
      "access",
      "accessSync",
      "appendFile",
      "appendFileSync",
      "chmod",
      "chmodSync",
      "close",
      "closeSync",
      "copyFile",
      "copyFileSync",
      "cp",
      "cpSync",
      "createReadStream",
      "createWriteStream",
      "existsSync",
      "lstat",
      "lstatSync",
      "mkdir",
      "mkdirSync",
      "open",
      "openSync",
      "readFile",
      "readFileSync",
      "readdir",
      "readdirSync",
      "readlink",
      "readlinkSync",
      "realpath",
      "realpathSync",
      "rename",
      "renameSync",
      "rm",
      "rmSync",
      "stat",
      "statSync",
      "symlink",
      "symlinkSync",
      "unlink",
      "unlinkSync",
      "watch",
      "writeFile",
      "writeFileSync",
    ],
    [
      "export const constants = {};",
      "export const promises = {};",
      "export const existsSync = () => false;",
      "export const readdirSync = () => [];",
      "export const realpathSync = (value) => value;",
      "export const mkdirSync = () => undefined;",
      "export const rmSync = () => undefined;",
    ],
  ),
  "fs/promises": cloudflareNodeBuiltinStubSource("fs/promises", [
    "access",
    "appendFile",
    "chmod",
    "copyFile",
    "cp",
    "lstat",
    "mkdtemp",
    "mkdir",
    "readFile",
    "readdir",
    "readlink",
    "realpath",
    "rename",
    "rm",
    "stat",
    "symlink",
    "unlink",
    "writeFile",
  ]),
  http: cloudflareNodeBuiltinStubSource("http", [
    "Agent",
    "ClientRequest",
    "IncomingMessage",
    "ServerResponse",
    "createServer",
    "get",
    "request",
  ]),
  http2: cloudflareNodeBuiltinStubSource("http2", [
    "Http2ServerRequest",
    "Http2ServerResponse",
    "constants",
    "connect",
    "createSecureServer",
    "createServer",
  ]),
  https: cloudflareNodeBuiltinStubSource("https", [
    "Agent",
    "createServer",
    "get",
    "request",
  ]),
  inspector: cloudflareNodeBuiltinStubSource("inspector", [
    "Session",
    "close",
    "open",
    "url",
    "waitForDebugger",
  ]),
  module: cloudflareNodeBuiltinStubSource(
    "module",
    ["Module", "builtinModules", "createRequire", "syncBuiltinESMExports"],
    [
      "export const builtinModules = [];",
      "export const createRequire = () => globalThis.require ?? ((specifier) => { throw new Error('Cannot require: ' + specifier); });",
    ],
  ),
  net: cloudflareNodeBuiltinStubSource(
    "net",
    ["Socket", "connect", "createConnection", "createServer", "isIP"],
    [
      `export const isIP = (value) => {
  const input = String(value ?? "");
  const ipv4Parts = input.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) {
    return 4;
  }
  if (input.includes(":") && /^[0-9A-Fa-f:.]+$/.test(input)) {
    return 6;
  }
  return 0;
};`,
    ],
  ),
  os: cloudflareNodeBuiltinStubSource(
    "os",
    [
      "arch",
      "cpus",
      "endianness",
      "freemem",
      "homedir",
      "hostname",
      "networkInterfaces",
      "platform",
      "release",
      "tmpdir",
      "totalmem",
      "type",
      "userInfo",
    ],
    [
      'export const EOL = "\\n";',
      'export const arch = () => "x64";',
      "export const cpus = () => [];",
      'export const endianness = () => "LE";',
      "export const freemem = () => 0;",
      'export const homedir = () => "/tmp";',
      'export const hostname = () => "cloudflare-worker";',
      "export const networkInterfaces = () => ({});",
      'export const platform = () => "linux";',
      'export const release = () => "";',
      'export const tmpdir = () => "/tmp";',
      "export const totalmem = () => 0;",
      'export const type = () => "Worker";',
      "export const userInfo = () => ({ username: 'worker', homedir: '/tmp' });",
    ],
  ),
  readline: cloudflareNodeBuiltinStubSource("readline", [
    "Interface",
    "clearLine",
    "clearScreenDown",
    "createInterface",
    "cursorTo",
    "emitKeypressEvents",
    "moveCursor",
  ]),
  repl: cloudflareNodeBuiltinStubSource("repl", ["start"]),
  sqlite: cloudflareNodeBuiltinStubSource("sqlite", ["DatabaseSync"]),
  sys: cloudflareNodeBuiltinStubSource("sys", [
    "debug",
    "deprecate",
    "error",
    "inspect",
    "log",
    "print",
    "puts",
  ]),
  tls: cloudflareNodeBuiltinStubSource("tls", [
    "TLSSocket",
    "connect",
    "createSecureContext",
    "createServer",
  ]),
  trace_events: cloudflareNodeBuiltinStubSource("trace_events", [
    "createTracing",
    "getEnabledCategories",
  ]),
  tty: cloudflareNodeBuiltinStubSource("tty", [
    "ReadStream",
    "WriteStream",
    "isatty",
  ]),
  v8: cloudflareNodeBuiltinStubSource("v8", [
    "deserialize",
    "getHeapStatistics",
    "serialize",
  ]),
  vm: cloudflareNodeBuiltinStubSource("vm", [
    "Script",
    "compileFunction",
    "createContext",
    "runInContext",
    "runInNewContext",
    "runInThisContext",
  ]),
  wasi: cloudflareNodeBuiltinStubSource("wasi", ["WASI"]),
  worker_threads: cloudflareNodeBuiltinStubSource(
    "worker_threads",
    ["MessageChannel", "MessagePort", "Worker", "isMainThread", "parentPort"],
    ["export const isMainThread = true;", "export const parentPort = null;"],
  ),
};

export interface GenerateWorkerEntryOptions {
  includeReactRouterSsr?: boolean;
}

interface ReactRouterAssetManifest {
  entry: ReactRouterAssetManifestEntry;
  routes: Record<string, ReactRouterAssetManifestRoute>;
  url: string;
}

interface ReactRouterAssetManifestEntry {
  module: string;
  imports?: string[];
  css?: string[];
}

interface ReactRouterAssetManifestRoute {
  id: string;
  module: string;
  imports?: string[];
  css?: string[];
  hasLoader?: boolean;
  clientActionModule?: string;
  clientLoaderModule?: string;
  clientMiddlewareModule?: string;
  hydrateFallbackModule?: string;
}

function normalizeConfiguredAppBasePath(): string {
  return normalizeAppBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
}

/** Plugins that require Node.js runtime and cannot run on edge/serverless */
const NODE_ONLY_PLUGINS = new Set([
  "terminal", // PTY requires child_process
  // @sentry/node ships node:fs / node:async_hooks bindings that don't load
  // on workerd / Cloudflare Workers. Templates running on edge presets can
  // mount their own edge-compatible Sentry wrapper if they want server
  // observability there; the framework default is the Node SDK.
  "sentry",
]);
const EDGE_SERVER_ENTRYPOINT = "@agent-native/core/server/edge";

function isNodeOnlyPlugin(filePath: string): boolean {
  const basename = path.basename(filePath, path.extname(filePath));
  return NODE_ONLY_PLUGINS.has(basename);
}

export function generateProvidedPluginsNitroPluginSource(
  pluginStems: string[],
): string {
  const stems = [...new Set(pluginStems.filter(Boolean))].sort();
  return `// AUTO-GENERATED by @agent-native/core deploy build
import { markDefaultPluginProvided } from "${EDGE_SERVER_ENTRYPOINT}";

const pluginStems = ${JSON.stringify(stems)};

export default function markBuildDiscoveredPlugins(nitroApp) {
  for (const stem of pluginStems) {
    markDefaultPluginProvided(nitroApp, stem);
  }
}
`;
}

async function writeProvidedPluginsNitroPlugin(): Promise<string | null> {
  const plugins = await discoverPlugins(cwd);
  const stems = plugins.map((plugin) =>
    path.basename(plugin, path.extname(plugin)),
  );
  if (stems.length === 0) return null;

  const tmpDir = path.join(cwd, ".deploy-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const pluginPath = path.join(tmpDir, "agent-native-provided-plugins.mjs");
  fs.writeFileSync(pluginPath, generateProvidedPluginsNitroPluginSource(stems));
  return pluginPath;
}

type RouteRules = Record<string, { headers?: Record<string, string> }>;

function addImmutableAssetRouteRule(
  routeRules: RouteRules,
  pathname: string,
): void {
  const existing = routeRules[pathname] ?? {};
  routeRules[pathname] = {
    ...existing,
    headers: {
      ...(existing.headers ?? {}),
      ...IMMUTABLE_ASSET_CACHE_HEADERS,
    },
  };
}

export function addImmutableAssetRouteRulesForClientBuild(
  routeRules: RouteRules,
  clientDir: string,
  appBasePath = "",
): void {
  for (const assetPath of collectImmutableAssetPaths(clientDir)) {
    addImmutableAssetRouteRule(routeRules, assetPath);
    const mountedPath = prefixAssetPath(assetPath, appBasePath);
    if (mountedPath !== assetPath) {
      addImmutableAssetRouteRule(routeRules, mountedPath);
    }
  }
}

/**
 * Generate the worker entry source code that wires up H3 + React Router SSR.
 *
 * If a workspace core is present (monorepo with `agent-native.workspaceCore`
 * configured and the named package resolves), any plugin slot that the
 * workspace core exports is imported from there instead of from
 * `@agent-native/core/server/edge`. This is the middle layer of the three-layer
 * inheritance model: app local > workspace core > framework default.
 */
export function generateWorkerEntry(
  routes: DiscoveredRoute[],
  pluginPaths: string[],
  defaultPluginStems: string[] = [],
  actions: DiscoveredAction[] = [],
  workspaceCore: WorkspaceCoreExports | null = null,
  immutableAssetPaths: string[] = [],
  builtAppBasePath = normalizeConfiguredAppBasePath(),
  options: GenerateWorkerEntryOptions = {},
): string {
  const includeReactRouterSsr = options.includeReactRouterSsr ?? true;
  // The worker ships as a static bundle with no access to runtime env, so the
  // deployment-wide SSR cache policy is baked in from this build's env.
  const ssrCacheHeaders = resolveSsrCacheHeaders();
  const ssrCacheKeyHeaders = resolveSsrCacheKeyHeaders();
  const routeImports: string[] = [];
  const routeRegistrations: string[] = [];

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const varName = `route_${i}`;
    routeImports.push(`import ${varName} from ${JSON.stringify(r.absPath)};`);
    routeRegistrations.push(
      `  app.on(${JSON.stringify(r.method.toUpperCase())}, ${JSON.stringify(r.route)}, ${varName});`,
    );
    if (r.method.toLowerCase() === "get") {
      routeRegistrations.push(
        `  app.on("HEAD", ${JSON.stringify(r.route)}, defineEventHandler(async (event) => {
    const originalReq = event.req;
    event.req = requestWithMethod(event.req, "GET");
    try {
      const result = await ${varName}(event);
      const response = result instanceof Response ? result : toResponse(result, event);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      event.req = originalReq;
    }
  }));`,
      );
    }
  }

  // Action route imports and registrations
  const actionImports: string[] = [];
  const actionRegistrations: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const varName = `action_${i}`;
    const handlerName = `action_handler_${i}`;
    actionImports.push(`import ${varName} from ${JSON.stringify(a.absPath)};`);
    // Mirror the runtime mount (action-routes.ts): `path = http?.path ?? name`.
    const routePath = `/_agent-native/actions/${a.path ?? a.name}`;
    actionRegistrations.push(
      `  const ${handlerName} = defineEventHandler(async (event) => {
    const configuredMethod = ${JSON.stringify(a.method.toUpperCase())};
    const requestMethod = event.req.method;
    const isFrontendMutation =
      event.req.headers.get("x-agent-native-frontend") === "1" &&
      ["POST", "PUT", "DELETE"].includes(configuredMethod) &&
      ["POST", "PUT", "DELETE"].includes(requestMethod);
    if (requestMethod !== configuredMethod && !isFrontendMutation) {
      return new Response(
        JSON.stringify({ error: \`Method not allowed. Use \${configuredMethod}.\` }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }
    const params = ${a.method === "get" ? "parseActionSearchParams(event.url.searchParams)" : "(await readBody(event)) ?? {}"};
    try {
      const caller =
        event.req.headers.get("x-agent-native-frontend") === "1"
          ? "frontend"
          : "http";
      const result = await ${varName}.run(params, { caller });
      if (typeof result === "string") { try { return JSON.parse(result); } catch { return result; } }
      return result;
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Action failed" }), { status: err?.message?.startsWith("Invalid action parameters") ? 400 : 500, headers: { "Content-Type": "application/json" } });
    }
  });
  app.on(${JSON.stringify(a.method.toUpperCase())}, ${JSON.stringify(routePath)}, ${handlerName});
${["post", "put", "delete"]
  .filter(
    (method) =>
      method !== a.method && ["post", "put", "delete"].includes(a.method),
  )
  .map(
    (method) =>
      `  app.on(${JSON.stringify(method.toUpperCase())}, ${JSON.stringify(routePath)}, ${handlerName});`,
  )
  .join("\n")}`,
    );
  }

  // Filter out Node-only plugins
  const edgePlugins = pluginPaths.filter((p) => !isNodeOnlyPlugin(p));
  const pluginImports: string[] = [];
  const pluginCalls: string[] = [];
  const providedPluginStems = new Set<string>();

  for (let i = 0; i < edgePlugins.length; i++) {
    const varName = `plugin_${i}`;
    providedPluginStems.add(
      path.basename(edgePlugins[i], path.extname(edgePlugins[i])),
    );
    pluginImports.push(
      `import ${varName} from ${JSON.stringify(edgePlugins[i])};`,
    );
    pluginCalls.push(`  if (typeof ${varName} === "function") {
    await ${varName}(nitroApp);
  }`);
  }
  // Auto-mounted default plugins (for slots the template doesn't override
  // locally). For each slot, prefer a workspace-core export over the
  // @agent-native/core default, if the workspace core provides one.
  const edgeDefaultStems = defaultPluginStems.filter(
    (stem) => !NODE_ONLY_PLUGINS.has(stem),
  );
  for (let i = 0; i < edgeDefaultStems.length; i++) {
    const stem = edgeDefaultStems[i];
    providedPluginStems.add(stem);
    const varName = `defaultPlugin_${i}`;

    const workspaceExportName = workspaceCore?.plugins?.[stem as never];
    if (workspaceCore && workspaceExportName) {
      // Workspace-core layer wins over the framework default.
      pluginImports.push(
        `import { ${workspaceExportName} as ${varName} } from ${JSON.stringify(
          `${workspaceCore.packageName}/server`,
        )};`,
      );
    } else {
      // Fall back to the framework default from the edge-safe core entrypoint.
      const defaultExportName = DEFAULT_PLUGIN_REGISTRY[stem];
      if (!defaultExportName) continue;
      pluginImports.push(
        `import { ${defaultExportName} as ${varName} } from "${EDGE_SERVER_ENTRYPOINT}";`,
      );
    }
    pluginCalls.push(`  if (typeof ${varName} === "function") {
    await ${varName}(nitroApp);
  }`);
  }
  const generatedPluginMarks =
    providedPluginStems.size > 0
      ? [
          ...new Set([
            ...Object.keys(DEFAULT_PLUGIN_REGISTRY),
            ...providedPluginStems,
          ]),
        ]
      : [];
  if (generatedPluginMarks.length > 0) {
    pluginImports.unshift(
      `import { markDefaultPluginProvided as markGeneratedPluginProvided } from "${EDGE_SERVER_ENTRYPOINT}";`,
    );
  }

  return `
// Auto-generated worker entry point for ${preset}
import { H3, defineEventHandler, readBody, toResponse } from "h3";
${includeReactRouterSsr ? 'import { createRequestHandler } from "react-router";' : ""}
${includeReactRouterSsr ? 'import * as serverBuild from "./server-build.js";' : ""}
${includeReactRouterSsr ? `import { runWithRequestContext } from "${EDGE_SERVER_ENTRYPOINT}";` : ""}

function normalizeAppBasePath(value) {
  if (!value || value === "/") return "";
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "/") return "";
  return "/" + trimmed.replace(/^\\/+/, "").replace(/\\/+$/, "");
}

function getAppBasePath() {
  const builtAppBasePath = ${JSON.stringify(builtAppBasePath)};
  return normalizeAppBasePath(
    globalThis.process?.env?.VITE_APP_BASE_PATH ||
      globalThis.process?.env?.APP_BASE_PATH ||
      builtAppBasePath,
  );
}

function stripAppBasePath(pathname) {
  const basePath = getAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function parseActionSearchParams(searchParams) {
  const params = {};
  for (const [rawKey, value] of searchParams.entries()) {
    const isArrayKey = rawKey.endsWith("[]");
    // The core client serializes arrays as key[]=value so one-item arrays
    // survive GET action parsing in generated worker deployments.
    const key = isArrayKey ? rawKey.slice(0, -2) : rawKey;
    const current = params[key];
    if (current === undefined) {
      params[key] = isArrayKey ? [value] : value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      params[key] = [current, value];
    }
  }
  return params;
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isFrameworkPath(pathname) {
  return (
    pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")
  );
}

function requestWithMountedApiPrefixStripped(request) {
  const basePath = getAppBasePath();
  if (!basePath) return request;
  const url = new URL(request.url);
  const strippedPathname = stripAppBasePath(url.pathname);
  if (strippedPathname === url.pathname) {
    return request;
  }
  if (!isApiPath(strippedPathname) && !isFrameworkPath(strippedPathname)) {
    return request;
  }
  url.pathname = strippedPathname;
  const rewritten = new Request(url, request);
  rewritten.waitUntil = request.waitUntil;
  return rewritten;
}

function prefixMountedPath(path, basePath) {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(basePath + "/")) return path;
  return basePath + path;
}

function prefixMountedHtml(html, basePath) {
  if (!basePath) return html;
  return html
    .replace(
      /\\b(href|src|action|formaction|poster)=(["'])(\\/(?!\\/)[^"']*)\\2/g,
      (_match, attr, quote, path) =>
        attr + "=" + quote + prefixMountedPath(path, basePath) + quote,
    )
    .replace(/url\\((["']?)(\\/(?!\\/)[^)'" ]+)\\1\\)/g, (_match, quote, path) => {
      const q = quote || "";
      return "url(" + q + prefixMountedPath(path, basePath) + q + ")";
    });
}

function firstNonEmpty() {
  for (const value of arguments) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
}

function isTruthyRuntimeValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(
    value.trim().toLowerCase(),
  );
}

function normalizeExplicitDeploymentEnvironment(value) {
  const normalized = firstNonEmpty(value)?.toLowerCase();
  if (!normalized) return;
  if (
    normalized !== "local" &&
    normalized !== "beta" &&
    normalized !== "production" &&
    normalized !== "preview"
  ) {
    throw new Error(
      'AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT must be "local", "beta", "production", or "preview"',
    );
  }
  return normalized;
}

function normalizeFallbackDeploymentEnvironment(value) {
  const normalized = firstNonEmpty(value)?.toLowerCase();
  if (normalized === "development" || normalized === "test") return "local";
  return normalized === "local" ||
    normalized === "beta" ||
    normalized === "production" ||
    normalized === "preview"
    ? normalized
    : undefined;
}

function resolveDeploymentEnvironment() {
  const env = globalThis.process?.env || {};
  const explicit = normalizeExplicitDeploymentEnvironment(
    env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT,
  );
  if (explicit) return explicit;

  const context = firstNonEmpty(
    typeof env.CONTEXT === "string" ? env.CONTEXT : undefined,
    typeof env.NETLIFY_CONTEXT === "string" ? env.NETLIFY_CONTEXT : undefined,
    typeof env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT === "string"
      ? env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT
      : undefined,
  )?.toLowerCase();
  const branch =
    typeof env.BRANCH === "string" ? env.BRANCH.trim().toLowerCase() : "";
  const vercelEnv = String(env.VERCEL_ENV || "").trim().toLowerCase();
  const sentryEnvironment = firstNonEmpty(env.SENTRY_ENVIRONMENT);
  if (branch === "beta") return "beta";
  if (
    branch === "production" ||
    (context === "production" && branch !== "beta")
  ) {
    return "production";
  }
  if (context === "branch-deploy" && branch === "main") return "beta";
  if (
    context === "deploy-preview" ||
    context === "branch-deploy" ||
    branch.startsWith("deploy-preview") ||
    vercelEnv === "preview"
  ) {
    return "preview";
  }
  if (!context && !branch && !vercelEnv && sentryEnvironment) {
    return normalizeFallbackDeploymentEnvironment(sentryEnvironment) || "production";
  }
  return (
    normalizeFallbackDeploymentEnvironment(firstNonEmpty(context, vercelEnv)) ||
    normalizeFallbackDeploymentEnvironment(env.NODE_ENV) ||
    "production"
  );
}

function getSentryClientConfigScript() {
  const env = globalThis.process?.env || {};
  const key = firstNonEmpty(env.SENTRY_CLIENT_KEY, env.VITE_SENTRY_CLIENT_KEY);
  const projectId = firstNonEmpty(
    env.SENTRY_PROJECT_ID,
    env.VITE_SENTRY_PROJECT_ID,
  );
  const host = firstNonEmpty(
    env.SENTRY_INGEST_HOST,
    env.VITE_SENTRY_INGEST_HOST,
  );
  const dsn =
    firstNonEmpty(
      env.SENTRY_CLIENT_DSN,
      env.VITE_SENTRY_CLIENT_DSN,
      env.VITE_SENTRY_DSN,
      env.SENTRY_DSN,
    ) || (key && projectId && host ? "https://" + key + "@" + host + "/" + projectId : undefined);
  const deploymentEnvironment = resolveDeploymentEnvironment();
  const config = {
    ...(dsn
      ? {
          sentryDsn: dsn,
          sentryEnvironment: deploymentEnvironment,
        }
      : {}),
    deploymentEnvironment,
  };
  return (
    '<script data-agent-native-sentry-config>' +
    'window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,' +
    JSON.stringify(config) +
    ");</script>"
  );
}

function getPostHogClientConfigScript() {
  // MUST stay consistent with resolvePublicPostHogConfig in
  // server/posthog-config.ts (worker bundles a string copy; it can't import it).
  // Never falls back to POSTHOG_API_KEY — that key can be a private one and
  // this string is inlined into the public, CDN-cached HTML shell.
  const env = globalThis.process?.env || {};
  const posthogKey = firstNonEmpty(
    env.POSTHOG_PUBLIC_KEY,
    env.VITE_POSTHOG_KEY,
    env.VITE_POSTHOG_PUBLIC_KEY,
  );
  if (!posthogKey) return null;
  const posthogHost = (
    firstNonEmpty(
      env.POSTHOG_PUBLIC_HOST,
      env.VITE_POSTHOG_HOST,
      env.POSTHOG_HOST,
    ) || "https://us.i.posthog.com"
  ).replace(/\\/+$/, "");
  const config = {
    posthogKey,
    posthogHost,
    posthogErrorTracking:
      (env.POSTHOG_ERROR_TRACKING || "").trim().toLowerCase() !== "false",
  };
  return (
    '<script data-agent-native-posthog-config>' +
    'window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,' +
    JSON.stringify(config) +
    ");</script>"
  );
}

function getRealtimeClientConfigScript() {
  // MUST stay byte-for-byte consistent with resolveRealtimeClientConfig in
  // server/sentry-config.ts (worker bundles a string copy; it can't import it).
  // Fail closed: require BOTH hosted transport AND an explicit gateway URL — no
  // production default, since this ships into the CDN-cached shell.
  const env = globalThis.process?.env || {};
  if (firstNonEmpty(env.AGENT_NATIVE_REALTIME_TRANSPORT) !== "hosted") {
    return null;
  }
  const gatewayBaseUrl = firstNonEmpty(env.AGENT_NATIVE_REALTIME_GATEWAY_URL);
  if (!gatewayBaseUrl) return null;
  const config = { realtime: { transport: "hosted", gatewayBaseUrl } };
  return (
    '<script data-agent-native-realtime-config>' +
    'window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,' +
    JSON.stringify(config) +
    ");</script>"
  );
}

function getAppOriginClientConfigScript() {
  // MUST stay consistent with resolvePublicAppOriginConfig in
  // server/app-origin-config.ts, and with the alias order declared on
  // app.url / workspace.* in app-config (worker bundles a string copy; it
  // can't import them). Impersonal values only — this ships into the
  // CDN-cached shell.
  const env = globalThis.process?.env || {};
  const appUrl = firstNonEmpty(
    env.APP_URL,
    env.VITE_APP_URL,
    env.BETTER_AUTH_URL,
    env.VITE_BETTER_AUTH_URL,
  );
  const workspaceGatewayUrl = firstNonEmpty(
    env.WORKSPACE_GATEWAY_URL,
    env.VITE_WORKSPACE_GATEWAY_URL,
  );
  const workspaceOAuthOrigin = firstNonEmpty(
    env.WORKSPACE_OAUTH_ORIGIN,
    env.VITE_WORKSPACE_OAUTH_ORIGIN,
  );
  const workspaceRuntime = [
    env.AGENT_NATIVE_WORKSPACE,
    env.VITE_AGENT_NATIVE_WORKSPACE,
  ].some((value) => isTruthyRuntimeValue(value)) ||
    Boolean(
      firstNonEmpty(
        env.AGENT_NATIVE_WORKSPACE_APPS_JSON,
        env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON,
      ),
    );
  const config = {
    ...(appUrl ? { appUrl } : {}),
    ...(workspaceGatewayUrl ? { workspaceGatewayUrl } : {}),
    ...(workspaceOAuthOrigin ? { workspaceOAuthOrigin } : {}),
    ...(workspaceRuntime ? { workspaceRuntime: true } : {}),
  };
  if (Object.keys(config).length === 0) return null;
  return (
    '<script data-agent-native-app-origin-config>' +
    'window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,' +
    JSON.stringify(config) +
    ");</script>"
  );
}

function injectHeadScript(html, script) {
  if (!script) return html;
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;
  return html.slice(0, headCloseIdx) + script + html.slice(headCloseIdx);
}

// Resolved from AGENT_NATIVE_SSR_CACHE at build time.
const SSR_CACHE_HEADERS = ${JSON.stringify(ssrCacheHeaders)};
const SSR_CACHE_KEY_HEADERS = ${JSON.stringify(ssrCacheKeyHeaders)};
const SSR_QUERY_CACHE_KEY_HEADER = ${JSON.stringify(SSR_QUERY_CACHE_KEY_HEADER)};
const DEFAULT_SPECULATION_RULES_PATH = ${JSON.stringify(DEFAULT_SPECULATION_RULES_PATH)};
const IMMUTABLE_ASSET_CACHE_CONTROL = ${JSON.stringify(IMMUTABLE_ASSET_CACHE_CONTROL)};
const IMMUTABLE_ASSET_PATHS = new Set(${JSON.stringify(
    [...new Set(immutableAssetPaths)].sort(),
  )});
const AGENT_NATIVE_SOCIAL_IMAGE_PATH = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  )};
const AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  )};
const AGENT_NATIVE_SOCIAL_IMAGE_ALT = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  )};
const AGENT_NATIVE_SOCIAL_IMAGE_TYPE = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  )};
const AGENT_NATIVE_SOCIAL_IMAGE_WIDTH = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  )};
const AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT = ${JSON.stringify(
    AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  )};
const OG_IMAGE_META_RE = /<meta\\b(?=[^>]*\\bproperty=(["'])og:image\\1)[^>]*>/i;
const TWITTER_CARD_META_RE = /<meta\\b(?=[^>]*\\bname=(["'])twitter:card\\1)[^>]*>/i;
const TWITTER_IMAGE_META_RE = /<meta\\b(?=[^>]*\\bname=(["'])twitter:image\\1)[^>]*>/i;

function withAgentNativeSocialImageCacheBuster(image) {
  const separator = image.includes("?") ? "&" : "?";
  return image + separator + "v=" + encodeURIComponent(AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER);
}

function defaultSocialImageUrl(request, basePath) {
  return withAgentNativeSocialImageCacheBuster(
    new URL(prefixMountedPath(AGENT_NATIVE_SOCIAL_IMAGE_PATH, basePath), request.url).toString()
  );
}

function injectDefaultSocialImageMeta(html, imageUrl) {
  const headCloseIdx = html.indexOf("</head>");
  if (headCloseIdx === -1) return html;

  const hasAnySocialImage =
    OG_IMAGE_META_RE.test(html) || TWITTER_IMAGE_META_RE.test(html);
  const tags = [];

  if (!hasAnySocialImage) {
    tags.push('<meta property="og:image" content="' + imageUrl + '">');
    tags.push('<meta property="og:image:secure_url" content="' + imageUrl + '">');
    tags.push('<meta property="og:image:type" content="' + AGENT_NATIVE_SOCIAL_IMAGE_TYPE + '">');
    tags.push('<meta property="og:image:width" content="' + AGENT_NATIVE_SOCIAL_IMAGE_WIDTH + '">');
    tags.push('<meta property="og:image:height" content="' + AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT + '">');
    tags.push('<meta property="og:image:alt" content="' + AGENT_NATIVE_SOCIAL_IMAGE_ALT + '">');
  }
  if (!TWITTER_CARD_META_RE.test(html)) {
    tags.push('<meta name="twitter:card" content="summary_large_image">');
  }
  if (!hasAnySocialImage) {
    tags.push('<meta name="twitter:image" content="' + imageUrl + '">');
    tags.push('<meta name="twitter:image:alt" content="' + AGENT_NATIVE_SOCIAL_IMAGE_ALT + '">');
  }

  if (tags.length === 0) return html;
  return html.slice(0, headCloseIdx) + tags.join("") + html.slice(headCloseIdx);
}

function isSsrHtmlOrDataResponse(headers, status, pathname) {
  if (status < 200 || status >= 400) return false;
  const contentType = (headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) return true;
  return pathname.endsWith(".data") && contentType.includes("text/x-script");
}

/**
 * Apply the SSR cache policy to the response headers.
 *
 * SSR HTML and React Router .data responses are one impersonal public shell.
 * Always overwrite route cache hints so generated edge workers cannot drift
 * from the canonical Nitro/Netlify handler or send normal pages to origin.
 */
function applyDefaultSsrCacheHeader(headers, status, pathname) {
  const varyByQuery =
    (headers.get(SSR_QUERY_CACHE_KEY_HEADER) || "").trim().toLowerCase() === "query";
  headers.delete(SSR_QUERY_CACHE_KEY_HEADER);
  if (!isSsrHtmlOrDataResponse(headers, status, pathname)) return;

  headers.delete("set-cookie");
  const vary = headers.get("vary");
  if (vary) {
    const publicVary = vary
      .split(",")
      .map((value) => value.trim())
      .filter((value) => {
        const normalized = value.toLowerCase();
        return normalized && normalized !== "*" && normalized !== "cookie" && normalized !== "authorization";
      });
    if (publicVary.length > 0) headers.set("vary", publicVary.join(", "));
    else headers.delete("vary");
  }

  for (const [name, value] of Object.entries(SSR_CACHE_HEADERS)) {
    headers.set(name, value);
  }
  const netlifyVary = varyByQuery
    ? SSR_CACHE_KEY_HEADERS["netlify-vary"] ? "query" : undefined
    : SSR_CACHE_KEY_HEADERS["netlify-vary"];
  if (netlifyVary) headers.set("netlify-vary", netlifyVary);
  else headers.delete("netlify-vary");
}

function applyDefaultSpeculationRulesHeader(headers, status, basePath) {
  if (status < 200 || status >= 400) return;
  if (headers.has("speculation-rules")) return;

  const contentType = (headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return;

  // Cloudflare Speed Brain injects Speculation-Rules when origin omits this
  // header. Those browser prefetches carry Sec-Purpose: prefetch and
  // Cloudflare can return 503 before the request reaches origin. Publish an
  // explicit no-op ruleset by default; apps can still provide their own header.
  headers.set("speculation-rules", '"' + prefixMountedPath(DEFAULT_SPECULATION_RULES_PATH, basePath) + '"');
}
function isImmutableAssetRequest(request) {
  const pathname = stripAppBasePath(new URL(request.url).pathname);
  return IMMUTABLE_ASSET_PATHS.has(pathname);
}

function applyImmutableAssetCacheHeaders(response, request) {
  if (!isImmutableAssetRequest(request)) return response;
  if (!((response.status >= 200 && response.status < 300) || response.status === 304)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
  headers.set("CDN-Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
  headers.set("Netlify-CDN-Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function rewriteMountedResponse(response, basePath, pathname, request) {
  const clientConfigScript =
    [
      getSentryClientConfigScript(),
      getPostHogClientConfigScript(),
      getRealtimeClientConfigScript(),
      getAppOriginClientConfigScript(),
    ]
      .filter(Boolean)
      .join("") || null;
  const headers = new Headers(response.headers);
  applyDefaultSsrCacheHeader(headers, response.status, pathname);
  applyDefaultSpeculationRulesHeader(headers, response.status, basePath);

  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html") || !response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");
  return new Response(
    injectHeadScript(
      injectDefaultSocialImageMeta(
        prefixMountedHtml(html, basePath),
        defaultSocialImageUrl(request, basePath),
      ),
      clientConfigScript,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

function requestWithMethod(request, method) {
  return new Request(request.url, {
    method,
    headers: request.headers,
    signal: request.signal,
  });
}

function requestWithPathname(request, pathname) {
  const url = new URL(request.url);
  if (url.pathname === pathname) return request;
  url.pathname = pathname;
  return new Request(url, request);
}

function requestForAnonymousSsr(request) {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  return new Request(request, { headers });
}

function isStaticAppShellRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const p = stripAppBasePath(new URL(request.url).pathname);
  if (
    p.startsWith("/.well-known/") ||
    p.startsWith("/_agent-native/") ||
    isApiPath(p) ||
    p === "/favicon.ico" ||
    p === "/favicon.png" ||
    /\\.\\w+$/.test(p)
  ) {
    return false;
  }
  return true;
}

async function fetchStaticAppShell(request, env) {
  if (!env?.ASSETS || !isStaticAppShellRequest(request)) return null;
  const basePath = getAppBasePath();
  const p = stripAppBasePath(new URL(request.url).pathname);
  const shellRequest = requestWithPathname(
    requestWithMethod(request, "GET"),
    "/index.html",
  );
  let response;
  try {
    response = await env.ASSETS.fetch(shellRequest);
  } catch {
    return null;
  }
  if (response.status === 404) return null;
  if (request.method === "HEAD") {
    return rewriteMountedResponse(
      new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      basePath,
      p,
      request,
    );
  }
  return rewriteMountedResponse(response, basePath, p, request);
}

// API route handlers
${routeImports.join("\n")}

// Action handlers (auto-discovered from actions/)
${actionImports.join("\n")}

// Server plugins
${pluginImports.join("\n")}

let _handler;

async function getHandler() {
  if (_handler) return _handler;

  const app = new H3();

  // Build a fake nitroApp surface so framework plugins (which expect
  // \`nitroApp.h3["~middleware"]\`) can register routes via getH3App().
  const noop = () => {};
  const nitroApp = {
    h3: app,
    hooks: { hook: noop, callHook: noop, hookOnce: noop },
    captureError: noop,
  };

  // CORS — applied as global middleware via .use(handler)
  app.use(defineEventHandler((event) => {
    if (event.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF,X-User-Timezone,X-Agent-Native-Session-Id,X-Agent-Native-Client-Platform,X-Agent-Native-Tool-Bridge,X-Agent-Native-Tool-Id,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id,X-Agent-Native-Embed-Target",
        },
      });
    }
  }));

  // Run plugins — they call getH3App(nitroApp).use(path, handler) which
  // pushes path-prefix middleware onto app["~middleware"].
  // Pre-mark every build-time plugin slot before any plugin awaits the runtime
  // default bootstrap. Bundled serverless workers often lack server/plugins/
  // on disk, so runtime discovery would otherwise auto-mount duplicate
  // framework defaults before later custom plugins get a chance to mark
  // themselves as provided.
${generatedPluginMarks.map((stem) => `  markGeneratedPluginProvided(nitroApp, ${JSON.stringify(stem)});`).join("\n")}
${pluginCalls.join("\n")}

  // Register API routes
${routeRegistrations.join("\n")}

  // Register action routes (/_agent-native/actions/*)
${actionRegistrations.join("\n")}

${
  includeReactRouterSsr
    ? `  // SSR catch-all for React Router
  const rrHandler = createRequestHandler(() => serverBuild);
  app.all("/**", defineEventHandler(async (event) => {
    const basePath = getAppBasePath();
    const p = stripAppBasePath(new URL(event.req.url).pathname);
    if (
      p.startsWith("/.well-known/") ||
      p.startsWith("/_agent-native/") ||
      isApiPath(p) ||
      p === "/favicon.ico" ||
      p === "/favicon.png" ||
      (/\\.\\w+$/.test(p) && !p.endsWith(".data"))
    ) {
      return new Response(null, { status: 404 });
    }
    const request = requestForAnonymousSsr(requestWithPathname(event.req, p));
    const anonymousContext = { userEmail: undefined, orgId: undefined };
    if (event.req.method === "HEAD") {
      const getRequest = requestWithMethod(request, "GET");
      const response = await runWithRequestContext(
        anonymousContext,
        () => rrHandler(getRequest)
      );
      return rewriteMountedResponse(
        new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        basePath,
        p,
        getRequest
      );
    }
    return rewriteMountedResponse(
      await runWithRequestContext(anonymousContext, () => rrHandler(request)),
      basePath,
      p,
      request
    );
  }));`
    : ""
}

  _handler = app.fetch.bind(app);
  return _handler;
}

export default {
  async fetch(request, env, ctx) {
    // Attach the request-scoped continuation hook before any URL rewrite.
    if (typeof ctx?.waitUntil === "function") {
      request.waitUntil = ctx.waitUntil.bind(ctx);
    }
    if (env) {
      globalThis.process = globalThis.process || { env: {} };
      globalThis.process.env = globalThis.process.env || {};
      // Expose D1/KV/R2 bindings on globalThis.__cf_env for the db layer
      globalThis.__cf_env = env;
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          globalThis.process.env[key] = value;
        }
      }
    }

    // Try serving static assets first (CF Pages advanced mode).
    // Only attempt this for GET/HEAD — the ASSETS binding is a static file
    // server and returns 405 for any other method, which would short-circuit
    // API calls (PUT/POST/DELETE to /_agent-native/*) before they reach our
    // h3 middleware.
    if (env?.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return applyImmutableAssetCacheHeaders(assetResponse, request);
        }
      } catch {
        // Asset fetch failed — fall through to SSR
      }
    }

    const handler = await getHandler();
    const response = await handler(requestWithMountedApiPrefixStripped(request));
${
  includeReactRouterSsr
    ? "    return response;"
    : `    if (response.status === 404) {
      const shellResponse = await fetchStaticAppShell(request, env);
      if (shellResponse) return shellResponse;
    }
    return response;`
}
  }
};
`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function findReactRouterManifest(distDir: string): ReactRouterAssetManifest {
  const assetsDir = path.join(distDir, "assets");
  const manifestFile = fs
    .readdirSync(assetsDir)
    .find((file) => /^manifest-[\w-]+\.js$/.test(file));
  if (!manifestFile) {
    throw new Error(`React Router client manifest not found in ${assetsDir}`);
  }

  const source = fs.readFileSync(path.join(assetsDir, manifestFile), "utf8");
  const match = source.match(/^window\.__reactRouterManifest=(.*);?\s*$/);
  if (!match) {
    throw new Error(`Could not parse React Router manifest ${manifestFile}`);
  }

  return JSON.parse(match[1].replace(/;$/, "")) as ReactRouterAssetManifest;
}

function collectModulePreloads(
  manifest: ReactRouterAssetManifest,
  route: ReactRouterAssetManifestRoute,
): string[] {
  const paths = new Set<string>();
  const add = (value: string | undefined) => {
    if (value) paths.add(value);
  };
  add(manifest.url);
  add(manifest.entry.module);
  manifest.entry.imports?.forEach(add);
  add(route.module);
  route.imports?.forEach(add);
  add(route.clientActionModule);
  add(route.clientLoaderModule);
  add(route.clientMiddlewareModule);
  add(route.hydrateFallbackModule);
  return [...paths];
}

function collectStylesheetLinks(
  manifest: ReactRouterAssetManifest,
  route: ReactRouterAssetManifestRoute,
): string[] {
  return [...new Set([...(manifest.entry.css ?? []), ...(route.css ?? [])])];
}

function generateRouteModuleImportScript(
  manifest: ReactRouterAssetManifest,
  route: ReactRouterAssetManifestRoute,
): string {
  const modules = [
    ["route0", route.module],
    ["route0_clientAction", route.clientActionModule],
    ["route0_clientLoader", route.clientLoaderModule],
    ["route0_clientMiddleware", route.clientMiddlewareModule],
    ["route0_hydrateFallback", route.hydrateFallbackModule],
  ] as const;
  const imports = modules
    .filter(([, modulePath]) => modulePath)
    .map(
      ([name, modulePath]) =>
        `import * as ${name} from ${JSON.stringify(modulePath)};`,
    );
  const parts = modules
    .filter(([, modulePath]) => modulePath)
    .map(([name]) => `...${name}`);

  return [
    `import ${JSON.stringify(manifest.url)};`,
    ...imports,
    `window.__reactRouterRouteModules = {${JSON.stringify(route.id)}:{${parts.join(",")}}};`,
    `import(${JSON.stringify(manifest.entry.module)});`,
  ].join("\n");
}

const EMPTY_REACT_ROUTER_TURBO_STREAM =
  '[{"_1":2,"_3":-5,"_4":-5},"loaderData",{},"actionData","errors"]\n';

// Manifest fallbacks cannot execute server loaders, so root loaders get the
// framework's default locale shape to keep hydration from reading undefined.
const DEFAULT_ROOT_LOADER_REACT_ROUTER_TURBO_STREAM =
  '[{"_1":2,"_3":-5,"_4":-5},"loaderData",{"_5":6},"actionData","errors","root",{"_7":8,"_9":10,"_11":12,"_13":14},"locale","en-US","preference",{"_7":15},"dir","ltr","messages",{},"system"]\n';

export function generateCloudflarePagesStaticShellFromManifest(
  manifest: ReactRouterAssetManifest,
  basePath = normalizeConfiguredAppBasePath(),
): string {
  const rootRoute = manifest.routes.root;
  if (!rootRoute) {
    throw new Error("React Router manifest is missing the root route");
  }

  const modulePreloads = collectModulePreloads(manifest, rootRoute)
    .map(
      (href) =>
        `<link rel="modulepreload" href="${escapeHtmlAttribute(href)}"/>`,
    )
    .join("");
  const stylesheets = collectStylesheetLinks(manifest, rootRoute)
    .map(
      (href) => `<link rel="stylesheet" href="${escapeHtmlAttribute(href)}"/>`,
    )
    .join("");
  const routeModuleScript = generateRouteModuleImportScript(
    manifest,
    rootRoute,
  );
  const context = {
    basename: basePath || "/",
    future: { unstable_optimizeDeps: false },
    routeDiscovery: { mode: "initial" },
    ssr: true,
    isSpaMode: true,
  };
  const encodedInitialState = rootRoute.hasLoader
    ? DEFAULT_ROOT_LOADER_REACT_ROUTER_TURBO_STREAM
    : EMPTY_REACT_ROUTER_TURBO_STREAM;

  // guard:allow-raw-color - static shell loads before app theme tokens exist
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/><link rel="icon" type="image/svg+xml" href="/favicon.svg"/>${modulePreloads}${stylesheets}</head><body><div style="display:flex;align-items:center;justify-content:center;height:100vh;width:100%"><svg role="status" aria-label="Loading" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:an-spin 1s linear infinite;opacity:0.7"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg><style>@keyframes an-spin { to { transform: rotate(360deg) } } @media (prefers-color-scheme: dark) { html { background: #09090b; color: #fafafa } }</style></div><script>window.__reactRouterContext = ${JSON.stringify(context)};window.__reactRouterContext.stream = new ReadableStream({start(controller){window.__reactRouterContext.streamController = controller;}}).pipeThrough(new TextEncoderStream());</script><script type="module" async="">${routeModuleScript}</script><!--$--><script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(encodedInitialState)});</script><!--$--><script>window.__reactRouterContext.streamController.close();</script><!--/$--><!--/$--></body></html>`;
}

function writeCloudflarePagesStaticShell({
  serverDir,
  distDir,
  tmpDir,
}: {
  serverDir: string;
  distDir: string;
  tmpDir: string;
}): void {
  const serverEntry = path.join(serverDir, "index.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`React Router server build not found at ${serverEntry}`);
  }

  const outFile = path.join(distDir, "index.html");
  const renderScript = path.join(tmpDir, "render-cloudflare-static-shell.mjs");
  const basePath = normalizeConfiguredAppBasePath();
  fs.writeFileSync(
    renderScript,
    `
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const cwd = ${JSON.stringify(cwd)};
const serverEntry = ${JSON.stringify(serverEntry)};
const outFile = ${JSON.stringify(outFile)};
const basePath = ${JSON.stringify(basePath)};

const requireFromApp = createRequire(cwd + "/package.json");
const reactRouterEntry = requireFromApp.resolve("react-router");
const { createRequestHandler } = await import(pathToFileURL(reactRouterEntry).href);
const serverBuild = await import(pathToFileURL(serverEntry).href);
const handler = createRequestHandler(serverBuild, "production");
const pathname = basePath ? basePath + "/" : "/";
const response = await handler(
  new Request(new URL(pathname, "https://agent-native.local"), {
    headers: { "X-React-Router-SPA-Mode": "yes" },
  }),
);
const html = await response.text();

if (!html || !html.includes("__reactRouterContext") || !html.includes("entry.client")) {
  throw new Error("React Router did not render a usable Cloudflare Pages static shell");
}

fs.writeFileSync(outFile, html);
process.exit(0);
`,
  );

  try {
    execFileSync(process.execPath, [renderScript], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        IS_RR_BUILD_REQUEST: "yes",
      },
      stdio: "inherit",
    });
    console.log("[deploy] Wrote Cloudflare Pages static app shell.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[deploy] React Router static shell render failed; using manifest fallback. ${message}`,
    );
    fs.writeFileSync(
      outFile,
      generateCloudflarePagesStaticShellFromManifest(
        findReactRouterManifest(distDir),
        basePath,
      ),
    );
    console.log("[deploy] Wrote Cloudflare Pages static app shell fallback.");
  }
}

/**
 * Build for Cloudflare Pages.
 * Output structure:
 *   dist/
 *     _worker.js       (bundled worker entry)
 *     assets/           (static client assets)
 */
async function buildCloudflarePages() {
  generateActionRegistryForProject(cwd);

  const buildDir = path.join(cwd, "build");
  const clientDir = path.join(buildDir, "client");
  const serverDir = path.join(buildDir, "server");
  const distDir = path.join(cwd, "dist");

  // Verify build output exists
  if (!fs.existsSync(clientDir) || !fs.existsSync(serverDir)) {
    console.error(
      "Build output not found at build/client/ and build/server/. Run react-router build first.",
    );
    process.exit(1);
  }

  // Clean dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Copy client assets to dist/
  copyDir(clientDir, distDir);

  const tmpDir = path.join(cwd, ".deploy-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  writeCloudflarePagesStaticShell({ serverDir, distDir, tmpDir });

  // Exclude _worker.js from being served as a public asset
  fs.writeFileSync(path.join(distDir, ".assetsignore"), "_worker.js\n");

  // Write package metadata inside _worker.js/ for the ES module worker that
  // Wrangler compiles and uploads for Cloudflare Pages.
  fs.mkdirSync(path.join(distDir, "_worker.js"), { recursive: true });
  fs.writeFileSync(
    path.join(distDir, "_worker.js", "package.json"),
    JSON.stringify({ main: "index.js", type: "module" }),
  );

  // Create empty stub for native modules that wrangler's bundler needs to resolve
  const stubsDir = path.join(distDir, "_worker.js", "stubs");
  fs.mkdirSync(stubsDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubsDir, "empty.js"),
    "export default {}; export const watch = () => ({ close() {} }); export const Database = class {};\n",
  );

  // Discover routes, plugins, actions, and the workspace core (if any).
  const routes = await discoverApiRoutes(cwd);
  const plugins = await discoverPlugins(cwd);
  const actions = await discoverActionFiles(cwd);
  const missingDefaults = await getMissingDefaultPlugins(cwd);
  const workspaceCore = await getWorkspaceCoreExports(cwd);
  const includeReactRouterSsr = false;

  const workspaceSlotCount = workspaceCore
    ? Object.keys(workspaceCore.plugins).length
    : 0;
  console.log(
    `[deploy] ${routes.length} API routes, ${actions.length} actions, ${plugins.length} plugins (${plugins.filter((p) => isNodeOnlyPlugin(p)).length} skipped as Node-only), ${missingDefaults.length} auto-mounted defaults${workspaceCore ? `, workspace-core ${workspaceCore.packageName} (${workspaceSlotCount} plugin slots)` : ""}`,
  );

  // Generate the worker entry
  const immutableAssetPaths = collectImmutableAssetPaths(clientDir);
  const entrySource = generateWorkerEntry(
    routes,
    plugins,
    missingDefaults,
    actions,
    workspaceCore,
    immutableAssetPaths,
    normalizeConfiguredAppBasePath(),
    { includeReactRouterSsr },
  );

  // Create _worker.js output directory
  const workerOutDir = path.join(distDir, "_worker.js");
  fs.mkdirSync(workerOutDir, { recursive: true });

  // Write the worker entry
  const entryFile = path.join(workerOutDir, "index.js");

  // Rewrite the server-build import to point at the copied files when this
  // worker intentionally includes React Router SSR.
  const adjustedEntry = includeReactRouterSsr
    ? entrySource.replace(
        `import * as serverBuild from "./server-build.js";`,
        `import * as serverBuild from "./server/index.js";`,
      )
    : entrySource;

  // Write a temp file for esbuild to bundle everything into a single worker entry.
  // When React Router SSR is enabled, the server build is copied to tmp so
  // esbuild can resolve it. Cloudflare Pages currently uses a static app shell
  // instead so the worker stays under the platform bundle size limit.
  // Name the entry "index.js" so esbuild outputs index.js in the outdir,
  // matching the _worker.js/index.js entry point that Cloudflare Pages expects.
  const tmpEntry = path.join(tmpDir, "index.js");
  fs.writeFileSync(tmpEntry, adjustedEntry);

  if (includeReactRouterSsr) {
    copyDir(serverDir, path.join(tmpDir, "server"));
  }

  // Create a require shim so CJS require("fs") calls resolve via ESM imports.
  // This is injected via esbuild --inject to replace its broken __require shim.
  fs.writeFileSync(
    path.join(tmpDir, "_require-shim.js"),
    generateRequireShim(),
  );

  const nitroServerAssetsStub = path.join(
    tmpDir,
    "_nitro-server-assets-stub.js",
  );
  fs.writeFileSync(
    nitroServerAssetsStub,
    [
      "const empty = async () => undefined;",
      "export const assets = {",
      "  getItem: empty,",
      "  getItemRaw: empty,",
      "  getKeys: async () => [],",
      "  getMeta: async () => undefined,",
      "  hasItem: async () => false,",
      "};",
      "export default assets;",
      "",
    ].join("\n"),
  );

  // Create stub modules for native/Node-only deps that can't run on Workers.
  // These get resolved by esbuild instead of the real modules, avoiding bundling
  // native code that would fail on the Workers runtime.
  const stubDir = path.join(tmpDir, "node_modules");
  for (const [mod, source] of Object.entries(CLOUDFLARE_WORKER_STUB_MODULES)) {
    const modDir = path.join(stubDir, mod);
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, "index.js"), source);
    fs.writeFileSync(
      path.join(modDir, "package.json"),
      JSON.stringify({ name: mod, main: "index.js", type: "module" }),
    );
  }
  for (const [mod, source] of Object.entries(
    CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES,
  )) {
    fs.writeFileSync(
      path.join(stubDir, `${mod.replace(/\//g, "__")}.js`),
      source,
    );
  }
  const stubAliases = cloudflareWorkerStubAliasArgs(stubDir);
  const nodeBuiltinStubDir = path.join(tmpDir, "node-builtin-stubs");
  fs.mkdirSync(nodeBuiltinStubDir, { recursive: true });
  const nodeBuiltinStubAliases: string[] = [];
  for (const [mod, source] of Object.entries(
    CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES,
  ).sort(([a], [b]) => b.length - a.length)) {
    const stubFile = path.join(
      nodeBuiltinStubDir,
      `${mod.replace(/\W+/g, "_")}.js`,
    );
    fs.writeFileSync(stubFile, source);
    nodeBuiltinStubAliases.push(
      `--alias:${mod}=${stubFile}`,
      `--alias:node:${mod}=${stubFile}`,
    );
  }

  const esbuildBin = findEsbuild();

  // Externalize node builtins (both bare and node: prefixed) — the require
  // shim handles bare ones. Also alias every `node:*` specifier to its bare
  // name so esbuild emits `import from "fs"` everywhere, never
  // `import from "node:fs"`. CF Pages Functions (wrangler 3.x, nodejs_compat
  // v1) rejects the `node:` prefix in chunks with:
  //   No such module "node:fs" imported from chunks/...
  // The alias is the authoritative fix; the post-build strip stays as belt
  // & suspenders in case esbuild emits a node: string via some other path.
  const builtinNames = getNodeBuiltinNames();
  // Only externalize bare names. node:* externals would otherwise pin
  // the prefix in output; instead we alias node:* → bare so anything that
  // resolves past alias land as bare externals.
  const nodeBuiltinStubs = new Set(
    Object.keys(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES),
  );
  const nodeExternals = builtinNames
    .filter((n) => !nodeBuiltinStubs.has(n))
    .sort((a, b) => b.length - a.length)
    .map((n) => `--external:${n}`);
  const nodeAliases = builtinNames
    .filter((n) => !nodeBuiltinStubs.has(n))
    .sort((a, b) => b.length - a.length)
    .map((n) => `--alias:node:${n}=${n}`);

  // Hard externalize large client-only / node-only libraries so they don't
  // bloat the edge worker. These are never executed in the CF Pages runtime
  // — mermaid/excalidraw render in the browser, pdf-parse and @google/genai
  // run from node-only action scripts. Without this, slides' bundle hits
  // the 25 MiB Pages Functions limit.
  //
  // @anthropic-ai/tokenizer (tiktoken .wasm) and @resvg/resvg-js (native
  // .node binding) can't be bundled by esbuild at all — no loader for those
  // files. Both import sites degrade gracefully when the runtime import
  // fails: context-xray token counts fall back to char/4 estimates and the
  // OG image route falls back to SVG.
  const heavyClientExternals = CLOUDFLARE_WORKER_ESBUILD_EXTERNALS.filter(
    (p) =>
      !Object.prototype.hasOwnProperty.call(CLOUDFLARE_WORKER_STUB_MODULES, p),
  ).map((p) => `--external:${p}`);

  execFileSync(
    esbuildBin,
    [
      tmpEntry,
      "--bundle",
      "--format=esm",
      "--target=es2022",
      // browser platform for npm resolution; node builtins externalized separately
      "--platform=browser",
      "--minify",
      // Single-file bundle (no --splitting). CF Pages Functions' deploy
      // validator fails to load chunked _worker.js/ bundles even when the
      // chunks contain only bare node-builtin imports (wrangler 3.101.0
      // + nodejs_compat v2). Matches main's working config.
      `--outdir=${workerOutDir}`,
      "--conditions=workerd,worker,import",
      // The ssr-handler imports a virtual module that only exists at dev time
      "--external:virtual:react-router/server-build",
      `--alias:#nitro/virtual/server-assets=${nitroServerAssetsStub}`,
      // Banner: override the __require shim that esbuild generates for CJS modules.
      // This provides a real require() backed by ESM imports of node builtins.
      // Without this, CF Workers rejects the bundle because esbuild's default
      // __require shim throws "Dynamic require of X is not supported".
      `--banner:js=${generateRequireShim()}`,
      // Externalize node: builtins — CF Workers runtime provides them
      ...nodeExternals,
      ...heavyClientExternals,
      ...stubAliases,
      ...nodeBuiltinStubAliases,
      // Rewrite node:* -> bare names so chunks never contain node: imports
      ...nodeAliases,
    ],
    { stdio: "inherit", cwd },
  );

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true });

  // Rewrite the external virtual import to a local stub.
  // esbuild externalizes "virtual:react-router/server-build" (used by ssr-handler),
  // but wrangler re-bundles and chokes on it. Replace the import with a no-op stub.
  const virtualStub = path.join(workerOutDir, "chunks", "_virtual-stub.js");
  fs.mkdirSync(path.dirname(virtualStub), { recursive: true });
  fs.writeFileSync(virtualStub, "export default {};\n");

  // Post-build patches — apply to ALL .js files in the worker output directory
  // (entry + chunks) since code can land in any chunk after splitting.
  const allJsFiles = getAllJsFiles(workerOutDir);
  for (const jsFile of allJsFiles) {
    let code = fs.readFileSync(jsFile, "utf-8");
    const isEntry = path.basename(jsFile) === "index.js";

    // Strip "node:" prefix from all imports/requires. Cloudflare Pages
    // Functions runs under nodejs_compat v1, which exposes builtins as
    // bare names ("fs") and rejects "node:fs" at worker init:
    //   No such module "node:fs" imported from chunks/...
    // (Workers-on-the-edge use v2 and require the prefix; Pages lags.)
    // Preserve the original quote char (single vs double) when rewriting —
    // esbuild's minifier sometimes places `import('node:buffer')` inside a
    // double-quoted string literal; swapping to double quotes breaks the
    // outer literal and produces `Unexpected identifier 'buffer'`.
    code = code.replace(
      /\bfrom(\s*)(["'])node:([^"']+)\2/g,
      (_, ws, q, mod) => `from${ws}${q}${mod}${q}`,
    );
    code = code.replace(
      /\bimport(\s*)(["'])node:([^"']+)\2/g,
      (_, ws, q, mod) => `import${ws}${q}${mod}${q}`,
    );
    // Strip `node:` prefix from any string literal that names a node
    // builtin. Covers dynamic imports, require(), getBuiltinModule(),
    // and minified wrappers like `Ut("node:fs")` that Nitro/h3 emit.
    // Pages' loader scans chunks for `"node:*"` literals and fails with
    // 'No such module "node:fs"' whether or not the string is reached
    // at runtime. Scoping to known builtins avoids touching user data.
    // Sorted longest-first so `fs/promises` matches before `fs`.
    const builtinsPattern = [...NODE_BUILTINS]
      .sort((a, b) => b.length - a.length)
      .join("|");
    const builtinRe = new RegExp(`(["'])node:(${builtinsPattern})\\1`, "g");
    code = code.replace(
      builtinRe,
      (_, q: string, mod: string) => `${q}${mod}${q}`,
    );

    // Rewrite virtual:react-router/server-build imports to the local stub.
    // The generated entry handles SSR directly; this import is dead code from ssr-handler.
    const relStub = path
      .relative(path.dirname(jsFile), virtualStub)
      .replace(/\\/g, "/");
    code = code.replace(
      /["']virtual:react-router\/server-build["']/g,
      `"./${relStub}"`,
    );

    // Patch createRequire(import.meta.url) — import.meta.url is undefined in CF Workers.
    // Matches both `from "module"` and `from "node:module"` — with the node:
    // prefix preserved (for nodejs_compat_v2), the latter is what esbuild now emits.
    code = code.replace(
      /\bimport\s*\{\s*createRequire\s+as\s+([\w$]+)\s*\}\s*from\s*["'](?:node:)?module["']\s*;/g,
      "var $1 = function() { return typeof require !== 'undefined' ? require : function(m) { throw new Error('require not supported: ' + m); }; };",
    );

    // Patch setInterval/setTimeout at module scope — CF Workers disallows timers in global scope.
    // Some dependencies (e.g. Anthropic SDK rate limiter) call setInterval at module init.
    // With code splitting, chunks evaluate before the entry, so the shim must be in every file.
    // The restore only happens in the entry's fetch() handler.
    if (!code.includes("__origSetInterval")) {
      const timerShim = [
        "var __origSetInterval=globalThis.setInterval;",
        "globalThis.setInterval=function(){return{unref(){},ref(){},close(){}}};",
      ].join("");
      code = timerShim + code;
    }
    if (isEntry) {
      const timerRestore =
        "if(__origSetInterval)globalThis.setInterval=__origSetInterval;";
      code = code.replace(
        /async fetch\(request,\s*env,\s*ctx\)\s*\{/,
        (match) => match + timerRestore,
      );
    }

    assertNoCloudflareWorkerStubDynamicImports(code, jsFile);

    fs.writeFileSync(jsFile, code);
  }

  // Report size
  const entrySize = fs.statSync(entryFile).size;
  const totalSize = getDirSize(workerOutDir);
  const chunkCount = allJsFiles.length - 1; // exclude entry
  console.log(
    `[deploy] Cloudflare Pages output written to dist/ (entry: ${(entrySize / 1024).toFixed(0)}KB, ${chunkCount} chunks, total: ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
  );
}

const NODE_BUILTINS = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "sqlite",
  "stream",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

export function getNodeBuiltinNames(): string[] {
  return NODE_BUILTINS;
}

/**
 * Generate a require() shim that bridges CJS require("fs") calls to ESM imports.
 * Injected via esbuild --inject so CJS deps work on Workers runtime.
 */
function generateRequireShim(): string {
  // Shim Node builtins that Cloudflare Pages can import, and return lazy
  // unavailable proxies for builtins that Pages Functions reject at upload
  // time (child_process, fs, net, etc.). This lets optional Node-only code stay
  // present in the shared bundle without making worker initialization fail.
  const stubbed = new Set(
    Object.keys(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES),
  );
  const shimmed = NODE_BUILTINS.filter((name) => !stubbed.has(name));

  // Bare module names — CF Pages Functions runs under nodejs_compat v1,
  // which rejects "node:fs" and only accepts "fs". The post-build pass in
  // buildCloudflarePages() also strips any `node:` prefix that esbuild or
  // dependencies emit elsewhere.
  const imports = shimmed
    .map((m) => `import __${m.replace("/", "_")} from "${m}";`)
    .join("");
  // Only bare-name keys. Pages' Functions loader appears to scan chunks
  // for "node:*" string literals and pre-resolves them as module specs —
  // so keeping "node:fs" as an object key caused deploy to fail with
  // 'No such module "node:fs"' even though nothing imported it. The
  // post-build strip turns every runtime `require("node:fs")` into
  // `require("fs")` so bare keys are sufficient.
  const entries = shimmed
    .map((m) => `"${m}":__${m.replace("/", "_")}`)
    .join(",");
  const stubEntries = Array.from(stubbed)
    .sort()
    .map((m) => `"${m}":__unavailable("${m}")`)
    .join(",");
  const allEntries = [entries, stubEntries].filter(Boolean).join(",");

  const messageChannelPolyfill = `if(typeof MessageChannel==="undefined"){globalThis.MessageChannel=class{constructor(){const a={onmessage:null},b={onmessage:null};a.postMessage=d=>{if(b.onmessage)setTimeout(()=>b.onmessage({data:d}),0)};b.postMessage=d=>{if(a.onmessage)setTimeout(()=>a.onmessage({data:d}),0)};this.port1=a;this.port2=b}}}`;
  return `${imports}\n${messageChannelPolyfill}\nconst __unavailable=(m)=>new Proxy({}, { get(_target, prop) { return (..._args) => { throw new Error(m + "." + String(prop) + " is unavailable in Cloudflare Pages workers"); }; } });\nconst __mods={${allEntries}};export var require=globalThis.require||function(m){const r=__mods[m];if(r!==undefined)return r;throw new Error("Cannot require: "+m)};\n`;
}

function findEsbuild(): string {
  // Try to resolve esbuild's binary via Node module resolution
  // This works regardless of hoisting or .bin symlink creation
  try {
    const _require = createRequire(cwd + "/");
    const esbuildPkg = path.dirname(_require.resolve("esbuild/package.json"));
    const bin = path.join(esbuildPkg, "bin", "esbuild");
    if (fs.existsSync(bin)) return bin;
  } catch {}

  // Fallback: check local and workspace .bin
  const localBin = path.resolve(cwd, "node_modules/.bin/esbuild");
  if (fs.existsSync(localBin)) return localBin;

  const workspaceRoot = findWorkspaceRoot(cwd);
  if (workspaceRoot) {
    const workspaceBin = path.resolve(
      workspaceRoot,
      "node_modules/.bin/esbuild",
    );
    if (fs.existsSync(workspaceBin)) return workspaceBin;
  }

  return "esbuild";
}

function findWorkspaceRoot(dir: string): string | null {
  let current = dir;
  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "pnpm-lock.yaml"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

/** Recursively collect all .js files in a directory. */
function getAllJsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllJsFiles(fullPath));
    } else if (entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

function getDirSize(dir: string): number {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

export { copyDir };

const LIBSQL_NATIVE_PACKAGE_NAMES = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm-gnueabihf",
  "linux-arm-musleabihf",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-x64-msvc",
];
const FFMPEG_STATIC_PACKAGE_NAME = "ffmpeg-static";
const RESVG_SCOPE = "@resvg";
const RESVG_PACKAGE_PREFIX = "resvg-js";
const SERVERLESS_BROWSER_RUNTIME_PACKAGES = [
  "@sparticuz/chromium",
  "playwright-core",
] as const;
const SERVERLESS_BROWSER_RUNTIME_CONSUMER = "@agent-native/creative-context";
const PACKAGE_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
  "peerDependencies",
];

// Serverless functions only ever run on 64-bit Linux. The darwin/win32/android
// and 32-bit-arm prebuilds of these native packages are ~100MB that can never
// execute there, and Netlify copies the whole server dir again for every extra
// emitted function — so the dead weight is paid once per function. Cold start
// scales with bundle size, and a page that opens several requests at once
// scales out to that many cold containers, which is how this surfaces: 502/504
// on the first burst rather than as an obviously slow deploy.
const SERVERLESS_NATIVE_PACKAGE_SUFFIXES = [
  "linux-x64-gnu",
  "linux-x64-musl",
  "linux-arm64-gnu",
  "linux-arm64-musl",
];

export function isServerlessNativePlatformPackage(
  packageName: string,
): boolean {
  return SERVERLESS_NATIVE_PACKAGE_SUFFIXES.some((suffix) =>
    packageName.endsWith(suffix),
  );
}

// Names a prebuild package by the platform it targets: `darwin-arm64`,
// `resvg-js-win32-ia32-msvc`, `linux-x64-gnu`. Matching only says "this is a
// per-platform prebuild"; isServerlessNativePlatformPackage decides whether it
// can run in the function.
const SERVERLESS_PLATFORM_PACKAGE_NAME =
  /(?:^|-)(?:darwin|win32|linux|android|freebsd)-[a-z0-9]+(?:-[a-z0-9]+)?$/;
const FFMPEG_STATIC_BINARY_NAMES =
  process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];
const SERVERLESS_FFMPEG_STATIC_PLATFORM = "linux";
const SERVERLESS_FFMPEG_STATIC_ARCHES = new Set<NodeJS.Architecture>([
  "arm64",
  "x64",
]);
const SERVERLESS_FUNCTION_PACKAGE_DENYLIST = new Set([
  "@vscode/test-electron",
  "electron",
  "electron-builder",
  "electron-updater",
  "electron-vite",
  "fsevents",
  "node-pty",
  "playwright",
]);
type ServerlessFfmpegStaticArch = "arm64" | "x64";

function serverlessFfmpegStaticTargetArchFromEnv(): ServerlessFfmpegStaticArch | null {
  const value = process.env.AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH;
  if (value === "arm64" || value === "x64") return value;
  return null;
}

export function shouldBundleFfmpegStaticForServerless(
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: NodeJS.Architecture = process.arch,
  targetArch: ServerlessFfmpegStaticArch | null = serverlessFfmpegStaticTargetArchFromEnv(),
): boolean {
  return (
    hostPlatform === SERVERLESS_FFMPEG_STATIC_PLATFORM &&
    targetArch !== null &&
    hostArch === targetArch &&
    SERVERLESS_FFMPEG_STATIC_ARCHES.has(targetArch)
  );
}

function nodeModulesAncestors(startDir: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, "node_modules");
    if (fs.existsSync(candidate)) dirs.push(candidate);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function readPackageManifest(
  packageDir: string,
): Record<string, unknown> | null {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  const manifest: unknown = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  );
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  return manifest as Record<string, unknown>;
}

function manifestDeclaresDependency(
  manifest: Record<string, unknown> | null,
  packageName: string,
): boolean {
  if (!manifest) return false;
  return PACKAGE_DEPENDENCY_FIELDS.some((field) => {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) return false;
    return Object.prototype.hasOwnProperty.call(deps, packageName);
  });
}

/**
 * Which dependency gives this app a path to the serverless browser runtime, or
 * null when it has none. Resolution cannot answer this: findInstalledPackageRoot
 * falls back to an ancestor + .pnpm store walk, so in a workspace every app
 * "resolves" the sibling package that actually declares Chromium and ships its
 * ~80MB into every emitted function.
 */
export function findServerlessBrowserRuntimeConsumer(
  projectCwd = cwd,
): string | null {
  const manifest = readPackageManifest(projectCwd);
  for (const packageName of [
    ...SERVERLESS_BROWSER_RUNTIME_PACKAGES,
    SERVERLESS_BROWSER_RUNTIME_CONSUMER,
  ]) {
    if (manifestDeclaresDependency(manifest, packageName)) return packageName;
    const linked = path.join(
      projectCwd,
      "node_modules",
      ...packageName.split("/"),
    );
    if (fs.existsSync(linked)) return packageName;
  }
  return null;
}

function packageRootFromResolvedPath(
  packageName: string,
  resolvedPath: string,
): string | null {
  let current = path.dirname(resolvedPath);
  while (true) {
    const manifest = readPackageManifest(current);
    if (manifest?.name === packageName) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findInstalledPackageRoot(
  packageName: string,
  nodeModulesRoots: string[],
  fromPackageDir?: string,
): string | null {
  if (fromPackageDir) {
    try {
      const requireFromPackage = createRequire(
        path.join(fromPackageDir, "package.json"),
      );
      const resolvedPath = requireFromPackage.resolve(packageName);
      const resolvedRoot = packageRootFromResolvedPath(
        packageName,
        resolvedPath,
      );
      if (resolvedRoot) return resolvedRoot;
      // coercion-ok: resolution failure means this optional store lookup is absent.
    } catch {
      // The dependency may be available only through the workspace pnpm store.
    }
  }

  const packagePath = packageName.split("/");
  const pnpmPrefix = `${packageName.replace("/", "+")}@`;
  for (const root of nodeModulesRoots) {
    const direct = path.join(root, ...packagePath);
    if (readPackageManifest(direct)?.name === packageName) return direct;

    const pnpmRoot = path.join(root, ".pnpm");
    if (!fs.existsSync(pnpmRoot)) continue;
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!entry.startsWith(pnpmPrefix)) continue;
      const nested = path.join(pnpmRoot, entry, "node_modules", ...packagePath);
      if (readPackageManifest(nested)?.name === packageName) return nested;
    }
  }
  return null;
}

function copyRuntimePackageTree(
  packageName: string,
  packageDir: string,
  serverDir: string,
  nodeModulesRoots: string[],
  copiedPackages: Set<string>,
): number {
  if (copiedPackages.has(packageName)) return 0;
  copiedPackages.add(packageName);

  const destination = path.join(
    serverDir,
    "node_modules",
    ...packageName.split("/"),
  );
  copyDir(packageDir, destination);

  const manifest = readPackageManifest(packageDir);
  const dependencies = manifest?.dependencies;
  if (!dependencies || typeof dependencies !== "object") return 1;

  let copiedCount = 1;
  for (const dependencyName of Object.keys(
    dependencies as Record<string, unknown>,
  )) {
    const dependencyDir = findInstalledPackageRoot(
      dependencyName,
      nodeModulesRoots,
      packageDir,
    );
    if (!dependencyDir) {
      throw new Error(
        `[deploy] Could not resolve ${dependencyName}, required by ${packageName}, for the serverless browser runtime.`,
      );
    }
    copiedCount += copyRuntimePackageTree(
      dependencyName,
      dependencyDir,
      serverDir,
      nodeModulesRoots,
      copiedPackages,
    );
  }
  return copiedCount;
}

export function copyInstalledBrowserRuntimePackages(
  serverDir: string | undefined,
  projectCwd = cwd,
): number {
  if (!serverDir || !fs.existsSync(serverDir)) return 0;

  const nodeModulesRoots = nodeModulesAncestors(projectCwd);
  const consumer = findServerlessBrowserRuntimeConsumer(projectCwd);
  if (!consumer) {
    const skippedBytes = SERVERLESS_BROWSER_RUNTIME_PACKAGES.reduce(
      (total, packageName) => {
        const packageDir = findInstalledPackageRoot(
          packageName,
          nodeModulesRoots,
        );
        return packageDir ? total + getDirSize(packageDir) : total;
      },
      0,
    );
    console.log(
      `[deploy] Skipped the serverless browser runtime (${SERVERLESS_BROWSER_RUNTIME_PACKAGES.join(
        ", ",
      )}): this app depends on neither ${SERVERLESS_BROWSER_RUNTIME_CONSUMER} ` +
        `nor a browser package. Kept ${(skippedBytes / 1024 / 1024).toFixed(1)}MB out of every emitted function.`,
    );
    return 0;
  }

  const copiedPackages = new Set<string>();
  let copiedCount = 0;
  for (const packageName of SERVERLESS_BROWSER_RUNTIME_PACKAGES) {
    const packageDir = findInstalledPackageRoot(packageName, nodeModulesRoots);
    if (!packageDir) continue;
    copiedCount += copyRuntimePackageTree(
      packageName,
      packageDir,
      serverDir,
      nodeModulesRoots,
      copiedPackages,
    );
  }

  if (copiedCount === 0) {
    // Not the same as the skip above: the app asked for the browser runtime and
    // the build could not find it, so anything that opens a browser will fail
    // at runtime instead of at build time.
    console.warn(
      `[deploy] ${consumer} needs the serverless browser runtime but none of ` +
        `${SERVERLESS_BROWSER_RUNTIME_PACKAGES.join(", ")} is installed; the function ships without it.`,
    );
    return 0;
  }

  console.log(
    `[deploy] Copied ${copiedCount} serverless browser runtime package(s) into the server bundle (required by ${consumer}).`,
  );
  return copiedCount;
}

function findInstalledLibsqlNativePackage(
  nodeModulesRoots: string[],
  packageName: string,
): string | null {
  for (const root of nodeModulesRoots) {
    const direct = path.join(root, "@libsql", packageName);
    if (fs.existsSync(path.join(direct, "index.node"))) return direct;

    const pnpmRoot = path.join(root, ".pnpm");
    if (!fs.existsSync(pnpmRoot)) continue;
    const pnpmPrefix = `@libsql+${packageName}@`;
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!entry.startsWith(pnpmPrefix)) continue;
      const nested = path.join(
        pnpmRoot,
        entry,
        "node_modules",
        "@libsql",
        packageName,
      );
      if (fs.existsSync(path.join(nested, "index.node"))) return nested;
    }
  }
  return null;
}

function hasFfmpegStaticBinary(packageDir: string): boolean {
  return FFMPEG_STATIC_BINARY_NAMES.some((binaryName) =>
    fs.existsSync(path.join(packageDir, binaryName)),
  );
}

function hasInstalledFfmpegStaticPackage(nodeModulesRoots: string[]): boolean {
  for (const root of nodeModulesRoots) {
    const direct = path.join(root, FFMPEG_STATIC_PACKAGE_NAME);
    if (fs.existsSync(path.join(direct, "package.json"))) return true;

    const pnpmRoot = path.join(root, ".pnpm");
    if (!fs.existsSync(pnpmRoot)) continue;
    const pnpmPrefix = `${FFMPEG_STATIC_PACKAGE_NAME}@`;
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!entry.startsWith(pnpmPrefix)) continue;
      const nested = path.join(
        pnpmRoot,
        entry,
        "node_modules",
        FFMPEG_STATIC_PACKAGE_NAME,
      );
      if (fs.existsSync(path.join(nested, "package.json"))) return true;
    }
  }
  return false;
}

export function findInstalledFfmpegStaticPackage(
  nodeModulesRoots: string[],
): string | null {
  for (const root of nodeModulesRoots) {
    const direct = path.join(root, FFMPEG_STATIC_PACKAGE_NAME);
    if (
      fs.existsSync(path.join(direct, "package.json")) &&
      hasFfmpegStaticBinary(direct)
    ) {
      return direct;
    }

    const pnpmRoot = path.join(root, ".pnpm");
    if (!fs.existsSync(pnpmRoot)) continue;
    const pnpmPrefix = `${FFMPEG_STATIC_PACKAGE_NAME}@`;
    for (const entry of fs.readdirSync(pnpmRoot)) {
      if (!entry.startsWith(pnpmPrefix)) continue;
      const nested = path.join(
        pnpmRoot,
        entry,
        "node_modules",
        FFMPEG_STATIC_PACKAGE_NAME,
      );
      if (
        fs.existsSync(path.join(nested, "package.json")) &&
        hasFfmpegStaticBinary(nested)
      ) {
        return nested;
      }
    }
  }
  return null;
}

export function findInstalledResvgPackages(
  nodeModulesRoots: string[],
): Array<{ packageName: string; packageDir: string }> {
  const found = new Map<string, string>();

  for (const root of nodeModulesRoots) {
    const directScope = path.join(root, RESVG_SCOPE);
    if (fs.existsSync(directScope)) {
      for (const entry of fs.readdirSync(directScope)) {
        if (!entry.startsWith(RESVG_PACKAGE_PREFIX)) continue;
        const packageDir = path.join(directScope, entry);
        if (fs.existsSync(path.join(packageDir, "package.json"))) {
          found.set(entry, packageDir);
        }
      }
    }

    const pnpmRoot = path.join(root, ".pnpm");
    if (!fs.existsSync(pnpmRoot)) continue;
    for (const entry of fs.readdirSync(pnpmRoot)) {
      const match = entry.match(/^@resvg\+(resvg-js[^@]*)@/);
      if (!match) continue;
      const packageName = match[1];
      const packageDir = path.join(
        pnpmRoot,
        entry,
        "node_modules",
        RESVG_SCOPE,
        packageName,
      );
      if (fs.existsSync(path.join(packageDir, "package.json"))) {
        found.set(packageName, packageDir);
      }
    }
  }

  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([packageName, packageDir]) => ({ packageName, packageDir }));
}

/**
 * Deploy-time gate for emitting the second `-background` Netlify function.
 * Netlify deploys are default-on; an explicit falsy
 * `AGENT_CHAT_DURABLE_BACKGROUND` value opts out. This is called only from the
 * Netlify preset, so non-Netlify builds remain unaffected. The gate and runtime
 * default must agree: otherwise the runtime could target a worker that the
 * deploy did not emit.
 */
export function isDurableBackgroundDeployEnabled(): boolean {
  return !isDurableBackgroundFlagExplicitlyDisabled();
}

/**
 * True when this build MUST ship the `-background` function: either the chat
 * opt-in or the integration durable dispatch depends on it at runtime.
 */
function isDurableBackgroundEmitRequired(): boolean {
  return (
    isDurableBackgroundDeployEnabled() ||
    isIntegrationDurableDispatchDeployEnabled() ||
    isRecurringJobsDeployEnabled()
  );
}

export const NETLIFY_INTEGRATION_RECOVERY_FUNCTION_NAME =
  "server-integration-recovery";

export function isIntegrationDurableDispatchDeployEnabled(): boolean {
  return isIntegrationDurableDispatchConfigured();
}

const NETLIFY_KEEP_WARM_FUNCTION_NAME = "agent-native-keep-warm";
export const NETLIFY_RECURRING_JOBS_FUNCTION_NAME =
  "agent-native-recurring-jobs";

/** Shared parser for truthy build environment flags. */
function isTruthyEnv(name: string): boolean {
  const value = process.env[name]?.trim();
  return !!value && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** Shared shape for the `AGENT_NATIVE_DISABLE_*` build kill switches. */
function isDisabledByEnv(name: string): boolean {
  return isTruthyEnv(name);
}

export function isRecurringJobsDeployEnabled(): boolean {
  return !isDisabledByEnv("AGENT_NATIVE_DISABLE_RECURRING_JOBS");
}

/**
 * Keep-warm is opt-in because a once-a-minute wake prevents autosuspend on
 * metered scale-to-zero databases. `AGENT_NATIVE_DISABLE_KEEP_WARM` remains a
 * compatibility kill switch and wins when both flags are set.
 */
export function isKeepWarmDeployEnabled(): boolean {
  return (
    isTruthyEnv("AGENT_NATIVE_ENABLE_KEEP_WARM") &&
    !isDisabledByEnv("AGENT_NATIVE_DISABLE_KEEP_WARM")
  );
}

/**
 * The background warm is a separate, much more expensive knob than the server
 * warm and gets its own switch. Warming `server` is one health request; warming
 * the `-background` Lambda is a *fresh container*, so every ping pays the full
 * on-demand `ensureTable()` schema-probe fan-out (hundreds of
 * `information_schema` round trips) before it does anything. At the default
 * cadence that is ~1,440 manufactured cold starts a day that no user asked for.
 * Turn this off to keep dispatch-latency protection for the server function
 * while dropping the probe storm.
 */
export function isKeepWarmBackgroundDeployEnabled(): boolean {
  return (
    isKeepWarmDeployEnabled() &&
    !isDisabledByEnv("AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND")
  );
}

const DEFAULT_KEEP_WARM_SCHEDULE = "* * * * *";

/**
 * Cadence for the keep-warm schedule, overridable with
 * `AGENT_NATIVE_KEEP_WARM_SCHEDULE` (standard 5-field cron).
 *
 * An unparseable value THROWS rather than falling back to the default. Falling
 * back would leave an operator who set this specifically to stop burning
 * database quota still burning it at the original once-a-minute cadence, with a
 * successful build and nothing in the log to say the value was ignored.
 */
export function resolveKeepWarmSchedule(): string {
  const raw = process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE?.trim();
  if (!raw) return DEFAULT_KEEP_WARM_SCHEDULE;
  const fields = raw.split(/\s+/);
  // The field count is checked separately from the field values because
  // `isValidCron` also accepts 6-field (seconds) and `@daily` forms that
  // Netlify's scheduler does not; "5 fields" is the narrower contract.
  if (fields.length !== 5 || !isValidCron(raw)) {
    throw new Error(
      `AGENT_NATIVE_KEEP_WARM_SCHEDULE must be a 5-field cron expression ` +
        `(minute hour day month weekday); got "${raw}" (${fields.length} field(s)). ` +
        `Example: "*/5 * * * *" for every five minutes.`,
    );
  }
  return raw;
}

/**
 * Emit a site-local Netlify Scheduled Function that wakes the public server
 * function and its database every minute. GitHub Actions schedules can be
 * delayed by tens of minutes, which is longer than a scale-to-zero database's
 * autosuspend window and leaves the next visitor to pay the cold-start cost.
 *
 * The feature is opt-in, the background half has its own kill switch, and the
 * cadence is configurable — see
 * `isKeepWarmDeployEnabled`, `isKeepWarmBackgroundDeployEnabled`, and
 * `resolveKeepWarmSchedule`. The tradeoff this function encodes is next-visitor
 * latency against database awake-time, and only the deployment knows which of
 * those it is paying for.
 */
export function emitSingleTemplateNetlifyKeepWarmFunction(
  projectCwd: string,
): void {
  if (!isKeepWarmDeployEnabled()) {
    const reason = isDisabledByEnv("AGENT_NATIVE_DISABLE_KEEP_WARM")
      ? "AGENT_NATIVE_DISABLE_KEEP_WARM is set."
      : "AGENT_NATIVE_ENABLE_KEEP_WARM is not enabled.";
    console.log(
      `[build] Keep-warm emit skipped: ${reason} ` +
        "The database is free to autosuspend; the next visitor after an idle " +
        "period pays its cold start.",
    );
    return;
  }
  // Resolved before anything is removed or written, so a bad cron fails the
  // build rather than leaving a wiped/half-emitted function directory behind.
  const keepWarmSchedule = resolveKeepWarmSchedule();
  const internalDir = path.join(projectCwd, ".netlify", "functions-internal");
  const serverBundle = path.join(internalDir, "server", "main.mjs");
  if (!fs.existsSync(serverBundle)) {
    console.warn(
      "[build] Keep-warm emit skipped: expected Nitro Netlify function at " +
        ".netlify/functions-internal/server/main.mjs was not found.",
    );
    return;
  }

  const dest = path.join(internalDir, NETLIFY_KEEP_WARM_FUNCTION_NAME);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  // The background Lambda is a SEPARATE container from `server`: warming the
  // health route never touches it, so it cold-started on essentially every
  // dispatch (18.4s observed to reach the agent loop). A POST with no runId is
  // rejected by the `_process-run` route before any DB work, so this only keeps
  // the container alive.
  const backgroundEntryPath = path.join(
    internalDir,
    AGENT_BACKGROUND_FUNCTION_NAME,
    `${AGENT_BACKGROUND_FUNCTION_NAME}.mjs`,
  );
  const backgroundWarmPath =
    isKeepWarmBackgroundDeployEnabled() &&
    isDurableBackgroundEmitRequired() &&
    fs.existsSync(backgroundEntryPath)
      ? JSON.stringify(AGENT_BACKGROUND_FUNCTION_URL_PATH)
      : "null";
  const entry = `const HEALTH_PATH = "/_agent-native/health";
const BACKGROUND_WARM_PATH = ${backgroundWarmPath};
const REQUEST_TIMEOUT_MS = 25_000;

function siteOrigin(request) {
  return new URL(request.url).origin;
}

async function warmBackgroundFunction(origin) {
  if (!BACKGROUND_WARM_PATH) return;
  const url = new URL(BACKGROUND_WARM_PATH, origin);
  try {
    // Best-effort: an unwarmed background function is a latency problem, not a
    // reason to fail the scheduled run that also warms the server + database.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "agent-native-netlify-keep-warm",
      },
      body: "{}",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    console.log("[agent-native-keep-warm] Warmed", url.toString(), response.status);
  } catch (error) {
    console.warn("[agent-native-keep-warm] Background warm failed:", url.toString(), error);
  }
}

export default async function handler(request) {
  const origin = siteOrigin(request);
  const backgroundWarm = warmBackgroundFunction(origin);
  const url = new URL(HEALTH_PATH, origin);
  let response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "agent-native-netlify-keep-warm" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[agent-native-keep-warm] Health request failed:", url.toString(), error);
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      "[agent-native-keep-warm] Health request failed with " +
        response.status +
        ": " +
        body.slice(0, 500),
    );
  }

  await backgroundWarm;
  console.log("[agent-native-keep-warm] Warmed", url.toString());
  return new Response(null, { status: 204 });
}

export const config = {
  name: "agent-native server keep warm",
  generator: "agent-native build",
  schedule: ${JSON.stringify(keepWarmSchedule)},
  nodeBundler: "none",
};
`;

  fs.writeFileSync(
    path.join(dest, `${NETLIFY_KEEP_WARM_FUNCTION_NAME}.mjs`),
    entry,
  );
  console.log(
    `[build] Emitted Netlify scheduled keep-warm function ` +
      `"${NETLIFY_KEEP_WARM_FUNCTION_NAME}" (schedule "${keepWarmSchedule}", ` +
      `background warm ${backgroundWarmPath === "null" ? "off" : "on"}).`,
  );
}

/**
 * Emit the durable recurring-job trigger. Netlify's scheduled function only
 * hands off work; the existing `-background` function owns the long sweep so
 * a model run is not constrained by the synchronous scheduled-function wall.
 *
 * The entry imports `node:crypto`, so `includedFiles: ["**"]` must stay: the
 * deploy packager only accepts an omitted `includedFiles` for scheduled
 * functions whose entry file has no import/require edge at all.
 */
export function emitSingleTemplateNetlifyRecurringJobsFunction(
  projectCwd: string,
): void {
  if (!isRecurringJobsDeployEnabled()) return;
  const internalDir = path.join(projectCwd, ".netlify", "functions-internal");
  const backgroundEntry = path.join(
    internalDir,
    AGENT_BACKGROUND_FUNCTION_NAME,
    `${AGENT_BACKGROUND_FUNCTION_NAME}.mjs`,
  );
  if (!fs.existsSync(backgroundEntry)) {
    throw new Error(
      "[build] Recurring-job trigger cannot be emitted without the durable background function.",
    );
  }

  const functionName = NETLIFY_RECURRING_JOBS_FUNCTION_NAME;
  const dest = path.join(internalDir, functionName);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const entry = `import { createHmac } from "node:crypto";

const BACKGROUND_PATH = ${JSON.stringify(AGENT_BACKGROUND_FUNCTION_URL_PATH)};
const SWEEP_PATH = ${JSON.stringify(RECURRING_JOBS_SWEEP_PATH)};
const TOKEN_SUBJECT = ${JSON.stringify(RECURRING_JOBS_SWEEP_TOKEN_SUBJECT)};
const PROCESSOR_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_FIELD)};
const PROCESSOR_ROUTE = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE)};
const PROCESSOR_ROUTE_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD)};

function siteOrigin(request) {
  return new URL(request.url).origin;
}

function token(secret) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(\`\${TOKEN_SUBJECT}:\${timestamp}\`)
    .digest("hex");
  return \`\${timestamp}.\${signature}\`;
}

export default async function handler(request) {
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    throw new Error("[recurring-jobs] A2A_SECRET is required for the scheduled sweep");
  }
  const url = new URL(BACKGROUND_PATH, siteOrigin(request));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${token(secret)}\`,
      "Content-Type": "application/json",
      "user-agent": "agent-native-recurring-jobs",
    },
    body: JSON.stringify({
      [PROCESSOR_FIELD]: PROCESSOR_ROUTE,
      [PROCESSOR_ROUTE_FIELD]: SWEEP_PATH,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      \`[recurring-jobs] Durable sweep handoff failed (\${response.status}): \${body.slice(0, 500)}\`,
    );
  }
  console.log("[recurring-jobs] Durable sweep handed off", url.toString());
  return new Response(null, { status: 204 });
}

export const config = {
  name: "agent-native recurring jobs",
  generator: "agent-native build",
  schedule: "* * * * *",
  nodeBundler: "none",
  includedFiles: ["**"],
};
`;
  fs.writeFileSync(path.join(dest, `${functionName}.mjs`), entry);
  console.log(
    `[build] Emitted Netlify scheduled recurring-job function "${functionName}".`,
  );
}

/**
 * Single-template Netlify build: emit an async (background) function INSIDE the
 * scanned functions dir so the chat `_process-run` worker runs on Netlify's
 * 15-min async function instead of the synchronous `/*` catch-all.
 * Additive + flag-gated (see `isDurableBackgroundDeployEnabled`).
 *
 * GROUNDED IN THE REAL NETLIFY BUILD OUTPUT (verified from a local Nitro build)
 * AND THE NETLIFY DOCS DEFAULT-URL RULE:
 *   - Nitro's `netlify` preset emits exactly ONE function source at
 *     `.netlify/functions-internal/server/`. `server.mjs` re-exports `main.mjs`
 *     and declares `export const config = { path: "/*", excludedPath:
 *     ["/.netlify/*"], preferStatic: true, ... }`. The `/*` catch-all is an
 *     IN-CODE Functions-API-v2 `config.path` and it ALREADY EXCLUDES
 *     `/.netlify/*`.
 *   - The generated `.netlify/netlify.toml` sets
 *     `functionsDirectory = ".netlify/functions-internal"`. Netlify scans EXACTLY
 *     that dir; functions placed anywhere else (e.g. `.netlify/functions/`, which
 *     is the BUILD OUTPUT dir where `@netlify/build` later writes the zipped
 *     functions + `manifest.json`) are NEVER deployed.
 *   - Every scanned function is reachable at its DEFAULT url
 *     `/.netlify/functions/<name>` BY DEFAULT. A custom `config.path` REMOVES
 *     that default url; declaring NO custom `config.path` KEEPS it.
 *
 * THEREFORE we:
 *   1. Emit the background function INTO the scanned dir
 *      (`.netlify/functions-internal/server-agent-background/`), sharing the same
 *      built `main.mjs` bundle, so Netlify discovers it and honors its config.
 *   2. Give its `export const config` `background: true` (→ async invoke,
 *      immediate 202, 15-min budget) and NO custom `config.path`. With no custom
 *      path the function keeps its DEFAULT url
 *      `/.netlify/functions/server-agent-background`, and because the Nitro
 *      `server` function's `/*` catch-all already excludes `/.netlify/*`, that
 *      default-url namespace is NEVER shadowed by the synchronous function — no
 *      catch-all patch is needed.
 *   3. The entry NORMALIZES/rewrites the incoming request pathname to
 *      `AGENT_CHAT_PROCESS_RUN_PATH` before delegating to `./main.mjs`. The
 *      function is reached at its default url
 *      (`/.netlify/functions/server-agent-background`), so the Nitro router needs
 *      the path rewritten to the framework `_process-run` route, preserving the
 *      method, ALL headers (the HMAC `Authorization: Bearer` MUST survive), and
 *      the body.
 *   4. Set `globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true` at cold start
 *      (read back by `isInBackgroundFunctionRuntime()` so the worker takes the
 *      ~13-min soft-timeout). A `globalThis` flag — NOT `process.env` — keeps the
 *      no-env-mutation guard satisfied and carries no cross-request state.
 *
 * The foreground dispatches to this DEFAULT url on hosted Netlify
 * (`resolveAgentChatProcessRunDispatchPath` → `AGENT_BACKGROUND_FUNCTION_URL_PATH`).
 *
 * WHY THIS IS THE DOC-CORRECT FIX: a prior attempt gave the function a custom
 * `config.path` (= the framework route) plus a catch-all `excludedPath` patch.
 * The custom `config.path` was NOT honored as a route in prod — a probe of
 * `POST /_agent-native/agent-chat/_process-run` returned 404. The doc-correct
 * approach (confirmed against the Netlify docs) is to use the DEFAULT function
 * url with no custom path: the function stays reachable at
 * `/.netlify/functions/<name>` and is never shadowed because `/.netlify/*` is
 * already excluded from the `server` catch-all.
 *
 * Safety net regardless of Netlify routing nuance: if the dispatch fast-fails
 * (e.g. the function was not emitted), the foreground handler degrades to an
 * inline 40s synchronous run (see production-agent.ts).
 */
export function emitSingleTemplateNetlifyBackgroundFunction(
  projectCwd: string,
): void {
  const internalDir = path.join(projectCwd, ".netlify", "functions-internal");
  const serverDir = path.join(internalDir, "server");
  if (!fs.existsSync(path.join(serverDir, "main.mjs"))) {
    // Nitro output layout differs from what we expected — cannot guess.
    const message =
      "Durable-background emit skipped: expected Nitro Netlify function " +
      "at .netlify/functions-internal/server/main.mjs was not found.";
    // Shipping without the function when the runtime depends on it is worse
    // than a red build: the deploy silently loses the 15-min budget forever.
    if (isDurableBackgroundEmitRequired())
      throw new Error(`[build] ${message}`);
    console.warn(`[build] ${message}`);
    return;
  }
  const backgroundName = AGENT_BACKGROUND_FUNCTION_NAME;
  // Emit INTO the SCANNED functions dir (functions-internal) so Netlify discovers
  // the function and honors its `export const config`. `.netlify/functions/` is
  // the build OUTPUT dir (where @netlify/build writes the zip + manifest) and is
  // NOT scanned — emitting there is why the standalone attempt 404'd.
  const dest = path.join(internalDir, backgroundName);
  fs.rmSync(dest, { recursive: true, force: true });
  cloneServerBundleForFunction(serverDir, dest);
  // Drop the original Nitro `/*` entry so our entry is the entrypoint and the
  // copied bundle does NOT re-register the catch-all `config.path`.
  fs.rmSync(path.join(dest, "server.mjs"), { force: true });

  const processRunPath = JSON.stringify(AGENT_CHAT_PROCESS_RUN_PATH);
  const a2aProcessTaskPath = JSON.stringify("/_agent-native/a2a/_process-task");
  const integrationProcessTaskPath = JSON.stringify(
    "/_agent-native/integrations/process-task",
  );
  const backgroundProcessorField = JSON.stringify(
    AGENT_BACKGROUND_PROCESSOR_FIELD,
  );
  const backgroundProcessorA2A = JSON.stringify(AGENT_BACKGROUND_PROCESSOR_A2A);
  const backgroundProcessorIntegration = JSON.stringify(
    AGENT_BACKGROUND_PROCESSOR_INTEGRATION,
  );
  const backgroundProcessorRoute = JSON.stringify(
    AGENT_BACKGROUND_PROCESSOR_ROUTE,
  );
  const backgroundProcessorRouteField = JSON.stringify(
    AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  );
  const recurringJobsSweepPath = JSON.stringify(RECURRING_JOBS_SWEEP_PATH);
  const entry = `// Mark this isolate as the durable background runtime BEFORE the handler
// bundle is imported, so isInBackgroundFunctionRuntime() reliably returns true
// in this function. The deployed Lambda name is NOT guaranteed to end in
// "-background" (Netlify may mangle/prefix it), so we cannot depend on
// AWS_LAMBDA_FUNCTION_NAME alone. A globalThis flag (NOT process.env) avoids the
// no-env-mutation guard and carries no cross-request state — it is a static,
// set-once isolate marker read back by isInBackgroundFunctionRuntime().
globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true;

// The framework route the Nitro router dispatches to (the _process-run plugin).
const PROCESS_RUN_PATH = ${processRunPath};
const A2A_PROCESS_TASK_PATH = ${a2aProcessTaskPath};
const INTEGRATION_PROCESS_TASK_PATH = ${integrationProcessTaskPath};
const BACKGROUND_PROCESSOR_FIELD = ${backgroundProcessorField};
const BACKGROUND_PROCESSOR_A2A = ${backgroundProcessorA2A};
const BACKGROUND_PROCESSOR_INTEGRATION = ${backgroundProcessorIntegration};
const BACKGROUND_PROCESSOR_ROUTE = ${backgroundProcessorRoute};
const BACKGROUND_PROCESSOR_ROUTE_FIELD = ${backgroundProcessorRouteField};
const RECURRING_JOBS_SWEEP_PATH = ${recurringJobsSweepPath};

function processorPathFromBody(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.[BACKGROUND_PROCESSOR_FIELD] === BACKGROUND_PROCESSOR_A2A) {
      return A2A_PROCESS_TASK_PATH;
    }
    if (
      parsed?.[BACKGROUND_PROCESSOR_FIELD] ===
      BACKGROUND_PROCESSOR_INTEGRATION
    ) {
      return INTEGRATION_PROCESS_TASK_PATH;
    }
    const route = parsed?.[BACKGROUND_PROCESSOR_ROUTE_FIELD];
    if (
      parsed?.[BACKGROUND_PROCESSOR_FIELD] === BACKGROUND_PROCESSOR_ROUTE &&
      typeof route === "string" &&
      route.startsWith("/") &&
      (route === RECURRING_JOBS_SWEEP_PATH ||
        route.includes("/api/_agent-native-background/")) &&
      !route.includes("?") &&
      !route.includes("#")
    ) {
      return route;
    }
    return null;
  } catch {
    return null;
  }
}

let cachedHandler;

// Netlify v2 invokes this as (request, context). The Nitro netlify handler is a
// Web-standard \`async (Request) => Response\` (see nitro/presets/netlify/runtime).
// This function declares NO custom \`config.path\`, so it is reached at its
// DEFAULT url (/.netlify/functions/${backgroundName}). The Nitro router only
// knows the framework route, so we REWRITE the incoming pathname to
// PROCESS_RUN_PATH before delegating. Method, ALL headers (the HMAC
// Authorization: Bearer MUST survive — the plugin verifies it) and the body are
// preserved by cloning the incoming Request with only its URL pathname set.
export default async function handler(request, context) {
  try {
    cachedHandler ??= (await import("./main.mjs")).default;
    const url = new URL(request.url);
    // Read the body once and pass it through. GET/HEAD have no body.
    const method = request.method || "POST";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await request.text() : undefined;
    url.pathname = processorPathFromBody(body) || PROCESS_RUN_PATH;
    const rewritten = new Request(url.toString(), {
      method,
      headers: request.headers,
      body,
    });
    // Netlify Functions v2 invokes the handler as (request, context); the Nitro
    // netlify handler accepts (request[, context]). Pass context through so a
    // handler that uses it (e.g. waitUntil) does not trip over an undefined arg
    // before it ever routes the request.
    return await cachedHandler(rewritten, context);
  } catch (err) {
    // Netlify already returned 202 for this background invocation and DISCARDS
    // this return, so a throw here is otherwise INVISIBLE — it would only surface
    // downstream as the reaper's "worker never claimed the run". Log it loudly
    // for the function log; the FOREGROUND circuit-breaker (production-agent.ts)
    // is what recovers the run by executing it inline when no worker claims.
    console.error(
      "[agent-background] wrapper failed before reaching the route:",
      (err && err.stack) || err,
    );
    throw err;
  }
}

export const config = {
  name: "agent background handler",
  generator: "agent-native build",
  // background: true makes Netlify invoke this ASYNCHRONOUSLY (immediate HTTP
  // 202 ack) with the 15-minute budget (Netlify docs:
  // build/functions/background-functions + build/functions/api). We declare NO
  // custom path, so the function keeps its DEFAULT url
  // /.netlify/functions/${backgroundName}; the Nitro \`server\` /* catch-all
  // already excludes /.netlify/* so that default url is never shadowed by the
  // synchronous function. The foreground dispatches to that default url.
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
  fs.writeFileSync(path.join(dest, `${backgroundName}.mjs`), entry);
  assertEmittedBackgroundFunctionOnDisk(dest, backgroundName);
  console.log(
    `[build] Emitted durable-background function "${backgroundName}" into the ` +
      `scanned dir .netlify/functions-internal with config { background:true } ` +
      `and NO custom path — reachable at its default url ` +
      `/.netlify/functions/${backgroundName} (never shadowed; the server /* ` +
      `catch-all already excludes /.netlify/*). REQUIRES real-deploy ` +
      `verification of Netlify async (202) invocation — see ` +
      `docs/design/durable-agent-runs.md.`,
  );
}

/**
 * Prove the artifact Netlify will scan actually landed. A partial copy (the
 * entry without its handler bundle) deploys as a function that 500s on every
 * invocation, which looks exactly like "no background function" at runtime.
 * Exported so the workspace deploy asserts the same shape.
 */
export function assertEmittedBackgroundFunctionOnDisk(
  destDir: string,
  functionName: string,
): void {
  const missing = [`${functionName}.mjs`, "main.mjs"].filter(
    (file) => !fs.existsSync(path.join(destDir, file)),
  );
  if (missing.length === 0) return;
  throw new Error(
    `[build] Durable-background function "${functionName}" was not fully emitted — ` +
      `missing ${missing.join(", ")} in ${destDir}. Netlify would deploy without ` +
      "the 15-min background function and every agent turn would silently run on " +
      "the synchronous function wall.",
  );
}

export function emitSingleTemplateNetlifyIntegrationRecoveryFunction(
  projectCwd: string,
): void {
  const internalDir = path.join(projectCwd, ".netlify", "functions-internal");
  const serverDir = path.join(internalDir, "server");
  if (!fs.existsSync(path.join(serverDir, "main.mjs"))) {
    console.warn(
      "[build] Integration recovery emit skipped: expected Nitro Netlify function " +
        "at .netlify/functions-internal/server/main.mjs was not found.",
    );
    return;
  }
  const functionName = NETLIFY_INTEGRATION_RECOVERY_FUNCTION_NAME;
  const dest = path.join(internalDir, functionName);
  fs.rmSync(dest, { recursive: true, force: true });
  cloneServerBundleForFunction(serverDir, dest);
  fs.rmSync(path.join(dest, "server.mjs"), { force: true });

  const entry = `import { createHmac } from "node:crypto";

const SWEEP_PATH = ${JSON.stringify(INTEGRATION_RETRY_SWEEP_PATH)};
const SWEEP_SUBJECT = ${JSON.stringify(INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT)};
globalThis.${INTEGRATION_RECOVERY_RUNTIME_MARKER} = true;

function enabled() {
  const raw = process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function token(secret) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(\`${INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT}:\${timestamp}\`)
    .digest("hex");
  return \`\${timestamp}.\${signature}\`;
}

let cachedHandler;

export default async function handler(request, context) {
  if (!enabled()) return new Response(null, { status: 204 });
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    console.error("[integration-recovery] A2A_SECRET is required; sweep skipped");
    return new Response(null, { status: 204 });
  }
  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  url.pathname = SWEEP_PATH;
  const rewritten = new Request(url.toString(), {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${token(secret)}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ taskId: SWEEP_SUBJECT }),
  });
  return cachedHandler(rewritten, context);
}

export const config = {
  name: "integration pending-task recovery",
  generator: "agent-native build",
  schedule: "* * * * *",
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
  fs.writeFileSync(path.join(dest, `${functionName}.mjs`), entry);
}

/**
 * Nitro's Netlify preset can emit a harmful fallback rewrite to
 * `/.netlify/functions/server`. With `config.path: "/*"`, that default URL is
 * removed, so the rewrite publishes platform 404s. Single-template deploys keep
 * Nitro's `preferStatic: true` so hashed `/assets/*` files in dist win before
 * the SSR catch-all runs.
 */
const NETLIFY_DEFAULT_FUNCTION_URL_REDIRECT =
  "/* /.netlify/functions/server 200";

function hasBareYjsRuntimeImport(source: string): boolean {
  return /\b(?:from\s*|import\s*\(\s*|import\s*)["']yjs(?:\/[^"']*)?["']/.test(
    source,
  );
}

const NETLIFY_BUNDLED_INGESTION_DEPENDENCIES = [
  "fast-xml-parser",
  "jszip",
  "officeparser",
  "pdf-parse",
  "pdfjs-dist",
] as const;

function hasBareRuntimeImport(source: string, packageName: string): boolean {
  const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b(?:from\\s*|import\\s*\\(\\s*|import\\s*)(["'\\\`])${escapedPackageName}(?:/[^"'\\\`]+)?\\1`,
  ).test(source);
}

function hasUnsupportedYjsSubpathImport(source: string): boolean {
  return /\b(?:from\s*|import\s*\(\s*|import\s*)["']yjs\/[^"']*["']/.test(
    source,
  );
}

function hasBundledVitestRuntime(source: string): boolean {
  return (
    /["'`]@vitest\//.test(source) ||
    /["'`]vitest\/(?:dist|src)\//.test(source) ||
    /__vitest_\d+__/.test(source)
  );
}

function walkServerJavaScriptFiles(
  dir: string,
  onFile: (filePath: string) => void,
): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkServerJavaScriptFiles(entryPath, onFile);
      continue;
    }
    if (/\.(?:[cm]?js)$/.test(entry.name)) onFile(entryPath);
  }
}

/**
 * Nitro receives the React Router SSR build as prebuilt chunks, so its normal
 * dependency resolver cannot reliably fold the preserved bare `yjs` imports
 * into the same module instance used by core's server collaboration code.
 * Keep Yjs external through Nitro, bundle its complete public ESM surface once,
 * then point every emitted server chunk at that one portable runtime module.
 */
export function bundleYjsRuntimeForServerlessOutput(
  serverDir: string,
  projectCwd: string,
): string[] {
  const bareImports: string[] = [];
  const unsupportedSubpathImports: string[] = [];

  walkServerJavaScriptFiles(serverDir, (filePath) => {
    const source = fs.readFileSync(filePath, "utf-8");
    if (!hasBareYjsRuntimeImport(source)) return;
    if (hasUnsupportedYjsSubpathImport(source)) {
      unsupportedSubpathImports.push(filePath);
      return;
    }
    bareImports.push(filePath);
  });

  if (unsupportedSubpathImports.length > 0) {
    throw new Error(
      `[deploy] Node/server output left unsupported yjs subpath imports in ${unsupportedSubpathImports.join(", ")}`,
    );
  }
  if (bareImports.length === 0) return [];

  const bundledYjsPath = path.join(serverDir, "_libs", "yjs-runtime.mjs");
  fs.mkdirSync(path.dirname(bundledYjsPath), { recursive: true });
  execFileSync(
    findEsbuild(),
    [
      resolveNitroBundledYjsEntry(),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--target=node22",
      "--minify",
      `--outfile=${bundledYjsPath}`,
    ],
    { cwd: projectCwd, stdio: "pipe" },
  );

  for (const filePath of bareImports) {
    const bundledImport = path
      .relative(path.dirname(filePath), bundledYjsPath)
      .split(path.sep)
      .join("/");
    const relativeBundledImport = bundledImport.startsWith(".")
      ? bundledImport
      : `./${bundledImport}`;
    const source = fs.readFileSync(filePath, "utf-8");
    fs.writeFileSync(
      filePath,
      source.replace(
        /(\b(?:from\s*|import\s*\(\s*|import\s*))(["'])yjs\2/g,
        (_match, importPrefix: string, quote: string) =>
          `${importPrefix}${quote}${relativeBundledImport}${quote}`,
      ),
    );
  }

  walkServerJavaScriptFiles(serverDir, (filePath) => {
    const bundledImport = path
      .relative(path.dirname(filePath), bundledYjsPath)
      .split(path.sep)
      .join("/");
    const relativeBundledImport = bundledImport.startsWith(".")
      ? bundledImport
      : `./${bundledImport}`;
    const source = fs.readFileSync(filePath, "utf-8");
    const rewritten = source.replace(
      /(\b(?:from\s*|import\s*\(\s*|import\s*))(["'])\.\.?\/(?:\.\.\/)*_libs\/yjs\.mjs\2/g,
      (_match, importPrefix: string, quote: string) =>
        `${importPrefix}${quote}${relativeBundledImport}${quote}`,
    );
    if (rewritten !== source) fs.writeFileSync(filePath, rewritten);
  });

  return bareImports;
}

/** Presets whose Node-style output needs the emitted Yjs runtime bundle. */
export function shouldBundleYjsRuntimeForPreset(targetPreset: string): boolean {
  return (
    targetPreset === "netlify" ||
    targetPreset === "vercel" ||
    targetPreset === "aws-lambda" ||
    targetPreset === "node" ||
    targetPreset === "node-server"
  );
}

// Netlify's hard limit is 250MB unzipped per function; keep 10MB of headroom
// for packaging variance so a passing guard does not sit on the platform edge.
const NETLIFY_FUNCTION_SIZE_BUDGET_BYTES = 120 * 1024 * 1024;
const NETLIFY_FUNCTION_HARD_LIMIT_BYTES = 240 * 1024 * 1024;
const NETLIFY_BROWSER_RUNTIME_SIZE_ALLOWANCE_BYTES = 100 * 1024 * 1024;
// Clips intentionally ships ffmpeg-static for server-side frame extraction,
// WebM seekability, filmstrips, and audio-only transcription. Keep that known
// runtime payload separate from the ordinary bundle-growth budget.
const NETLIFY_FFMPEG_RUNTIME_SIZE_ALLOWANCE_BYTES = 80 * 1024 * 1024;

function hasBundledFfmpegStaticRuntime(functionDir: string): boolean {
  if (!fs.existsSync(functionDir)) return false;
  const binaryName = FFMPEG_STATIC_BINARY_NAMES[0];
  return fs.existsSync(
    path.join(
      functionDir,
      "node_modules",
      FFMPEG_STATIC_PACKAGE_NAME,
      binaryName,
    ),
  );
}

function hasBundledServerlessBrowserRuntime(functionDir: string): boolean {
  return fs.existsSync(
    path.join(
      functionDir,
      "node_modules",
      "@sparticuz",
      "chromium",
      "bin",
      "chromium.br",
    ),
  );
}

function netlifyFunctionSizeBudget(functionDir: string): number {
  const allowance =
    (hasBundledServerlessBrowserRuntime(functionDir)
      ? NETLIFY_BROWSER_RUNTIME_SIZE_ALLOWANCE_BYTES
      : 0) +
    (hasBundledFfmpegStaticRuntime(functionDir)
      ? NETLIFY_FFMPEG_RUNTIME_SIZE_ALLOWANCE_BYTES
      : 0);
  return Math.min(
    NETLIFY_FUNCTION_SIZE_BUDGET_BYTES + allowance,
    NETLIFY_FUNCTION_HARD_LIMIT_BYTES,
  );
}

function reportNetlifyFunctionSizes(
  internalDir: string,
  failures: string[],
): void {
  if (!fs.existsSync(internalDir)) return;

  const functions = fs
    .readdirSync(internalDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: path.join(internalDir, entry.name),
      size: getDirSize(path.join(internalDir, entry.name)),
    }))
    .sort((a, b) => b.size - a.size);
  if (functions.length === 0) return;

  const toMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  const total = functions.reduce((sum, fn) => sum + fn.size, 0);
  // Every extra function is a full second copy of the bundle: the clone is
  // hard-linked on disk, but zip-it-and-ship-it sees regular files and uploads
  // each one whole, so the total is what the deploy actually pays.
  console.log(
    `[deploy] Netlify functions: ${functions.length} (${functions
      .map((fn) => `${fn.name} ${toMb(fn.size)}MB`)
      .join(", ")}) — ${toMb(total)}MB uploaded in total.`,
  );

  for (const fn of functions) {
    const budget = netlifyFunctionSizeBudget(fn.dir);
    if (fn.size <= budget) continue;
    // node_modules is always the biggest child and names nothing useful; the
    // packages inside it are what a regression actually adds.
    const nodeModulesDir = path.join(fn.dir, "node_modules");
    const inspectDir = fs.existsSync(nodeModulesDir) ? nodeModulesDir : fn.dir;
    const largest = fs
      .readdirSync(inspectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        size: getDirSize(path.join(inspectDir, entry.name)),
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .map((child) => `${child.name} ${toMb(child.size)}MB`)
      .join(", ");
    failures.push(
      `function ${fn.name} is ${toMb(fn.size)}MB, over the ${toMb(budget)}MB budget — largest: ${largest}`,
    );
  }
}

export function assertSingleTemplateNetlifyBuildOutput(
  projectCwd: string,
): void {
  const failures: string[] = [];
  const publishDir = path.join(projectCwd, "dist");
  const workspaceAppBasePath =
    [
      process.env.AGENT_NATIVE_WORKSPACE,
      process.env.VITE_AGENT_NATIVE_WORKSPACE,
    ].some((value) => isTruthyRuntimeValue(value)) ||
    Boolean(process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim()) ||
    Boolean(process.env.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON?.trim())
      ? normalizeConfiguredAppBasePath()
      : "";
  const assetsRelativeDir = workspaceAppBasePath
    ? path.join(workspaceAppBasePath.slice(1), "assets")
    : "assets";
  const assetsDisplayPath = path
    .join("dist", assetsRelativeDir)
    .split(path.sep)
    .join("/");
  const redirectsPath = path.join(publishDir, "_redirects");
  const internalDir = path.join(projectCwd, ".netlify", "functions-internal");
  const serverDir = path.join(internalDir, "server");
  const serverEntryPath = path.join(serverDir, "server.mjs");
  const serverMainPath = path.join(serverDir, "main.mjs");

  if (!fs.existsSync(publishDir)) {
    failures.push("missing publish directory: dist");
  } else {
    const assetsDir = path.join(publishDir, assetsRelativeDir);
    if (
      !fs.existsSync(assetsDir) ||
      fs.readdirSync(assetsDir).every((name) => name.startsWith("."))
    ) {
      failures.push(
        `${assetsDisplayPath} is missing hashed client assets — the publish dir would load an infinite spinner`,
      );
    }
  }

  if (fs.existsSync(publishDir) && fs.existsSync(redirectsPath)) {
    const redirects = fs.readFileSync(redirectsPath, "utf-8");
    if (
      redirects
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim().replace(/\s+/g, " ") ===
            NETLIFY_DEFAULT_FUNCTION_URL_REDIRECT,
        )
    ) {
      failures.push(
        'dist/_redirects must not contain "/* /.netlify/functions/server 200" — Nitro\'s custom config.path: "/*" removes that default function URL',
      );
    }
  }

  if (!fs.existsSync(serverDir)) {
    failures.push(
      "missing scanned Netlify server function: .netlify/functions-internal/server",
    );
  }

  if (!fs.existsSync(serverMainPath)) {
    failures.push(
      "missing Netlify server bundle: .netlify/functions-internal/server/main.mjs",
    );
  }

  if (!fs.existsSync(serverEntryPath)) {
    failures.push(
      "missing Netlify server entry: .netlify/functions-internal/server/server.mjs",
    );
  } else {
    const serverEntry = fs.readFileSync(serverEntryPath, "utf-8");
    if (!/\bpath\s*:\s*["']\/\*["']/.test(serverEntry)) {
      failures.push(
        'Netlify server entry is missing the "/*" catch-all function path',
      );
    }
    if (!serverEntry.includes('"/.netlify/*"')) {
      failures.push(
        'Netlify server catch-all is missing the "/.netlify/*" exclusion',
      );
    }
    if (!serverEntry.includes("./main.mjs")) {
      failures.push(
        "Netlify server entry does not reference the generated main.mjs bundle",
      );
    }
    if (!/\bpreferStatic:\s*true\b/.test(serverEntry)) {
      failures.push(
        "Netlify server entry must keep preferStatic: true so /assets/* is served from dist before the SSR catch-all",
      );
    }
  }

  // Netlify's function packager does not install arbitrary runtime package
  // imports left in Nitro chunks. A bare Yjs import here would deploy
  // successfully but fail on the first SSR request with ERR_MODULE_NOT_FOUND.
  // Keep this check adjacent to the output guard so both local builds and CI
  // reject that artifact before it reaches Netlify.
  const bareYjsImports: string[] = [];
  walkServerJavaScriptFiles(serverDir, (filePath) => {
    if (hasBareYjsRuntimeImport(fs.readFileSync(filePath, "utf-8"))) {
      bareYjsImports.push(path.relative(projectCwd, filePath));
    }
  });
  if (bareYjsImports.length > 0) {
    failures.push(
      `Netlify server bundle leaves yjs as a runtime import: ${bareYjsImports.join(", ")}`,
    );
  }

  const bareIngestionImports: string[] = [];
  walkServerJavaScriptFiles(serverDir, (filePath) => {
    const source = fs.readFileSync(filePath, "utf-8");
    for (const dependency of NETLIFY_BUNDLED_INGESTION_DEPENDENCIES) {
      if (hasBareRuntimeImport(source, dependency)) {
        bareIngestionImports.push(
          `${dependency} in ${path.relative(projectCwd, filePath)}`,
        );
      }
    }
  });
  if (bareIngestionImports.length > 0) {
    failures.push(
      `Netlify server bundle leaves ingestion dependencies as runtime imports: ${bareIngestionImports.join(", ")}`,
    );
  }

  // Nitro's `_libs/yjs.mjs` is a private tree-shaken chunk, not a package
  // facade. Repointing a prebuilt SSR chunk at it can request public exports
  // (notably `Text`) that the private chunk did not retain. The controlled
  // serverless pass must instead target the complete `yjs-runtime.mjs` bundle.
  const privateYjsImports: string[] = [];
  walkServerJavaScriptFiles(serverDir, (filePath) => {
    if (
      /\b(?:from\s*|import\s*\(\s*|import\s*)(["'])[^"']*_libs\/yjs\.mjs\1/.test(
        fs.readFileSync(filePath, "utf-8"),
      )
    ) {
      privateYjsImports.push(path.relative(projectCwd, filePath));
    }
  });
  if (privateYjsImports.length > 0) {
    failures.push(
      `Netlify server bundle imports Nitro's internal tree-shaken _libs/yjs.mjs: ${privateYjsImports.join(", ")}`,
    );
  }

  // React Router's filesystem route discovery can accidentally treat a
  // co-located *.test.ts route as production code. That bundles Vitest into
  // SSR and only fails when the first request executes the test helpers.
  const bundledVitestRuntime: string[] = [];
  walkServerJavaScriptFiles(serverDir, (filePath) => {
    if (hasBundledVitestRuntime(fs.readFileSync(filePath, "utf-8"))) {
      bundledVitestRuntime.push(path.relative(projectCwd, filePath));
    }
  });
  if (bundledVitestRuntime.length > 0) {
    failures.push(
      `Netlify server bundle contains Vitest test runtime code: ${bundledVitestRuntime.join(", ")}`,
    );
  }

  if (isDurableBackgroundEmitRequired()) {
    const backgroundDir = path.join(
      internalDir,
      AGENT_BACKGROUND_FUNCTION_NAME,
    );
    const backgroundEntryPath = path.join(
      backgroundDir,
      `${AGENT_BACKGROUND_FUNCTION_NAME}.mjs`,
    );
    if (!fs.existsSync(backgroundEntryPath)) {
      failures.push(
        `durable background is enabled but ${path.relative(
          projectCwd,
          backgroundEntryPath,
        )} was not emitted`,
      );
    } else {
      const backgroundEntry = fs.readFileSync(backgroundEntryPath, "utf-8");
      if (!/\bbackground\s*:\s*true\b/.test(backgroundEntry)) {
        failures.push(
          `durable background entry ${path.relative(
            projectCwd,
            backgroundEntryPath,
          )} is missing background: true`,
        );
      }
      if (/^\s*path\s*:/m.test(backgroundEntry)) {
        failures.push(
          `durable background entry ${path.relative(
            projectCwd,
            backgroundEntryPath,
          )} must not declare a custom path`,
        );
      }
    }
  }

  if (isIntegrationDurableDispatchDeployEnabled()) {
    const recoveryEntryPath = path.join(
      internalDir,
      NETLIFY_INTEGRATION_RECOVERY_FUNCTION_NAME,
      `${NETLIFY_INTEGRATION_RECOVERY_FUNCTION_NAME}.mjs`,
    );
    if (!fs.existsSync(recoveryEntryPath)) {
      failures.push(
        `integration durable dispatch is enabled but ${path.relative(
          projectCwd,
          recoveryEntryPath,
        )} was not emitted`,
      );
    } else {
      const recoveryEntry = fs.readFileSync(recoveryEntryPath, "utf-8");
      if (!/\bschedule\s*:\s*["']\* \* \* \* \*["']/.test(recoveryEntry)) {
        failures.push(
          `integration recovery entry ${path.relative(
            projectCwd,
            recoveryEntryPath,
          )} is missing the one-minute schedule`,
        );
      }
    }
  }

  reportNetlifyFunctionSizes(internalDir, failures);

  if (failures.length > 0) {
    throw new Error(
      "[deploy] Netlify deploy guard failed; refusing to publish an output " +
        "that would likely serve Netlify 404s or blow the function size limit:\n" +
        failures.map((failure) => `- ${failure}`).join("\n"),
    );
  }

  console.log(
    "[deploy] Netlify deploy guard passed: publish dir and catch-all server function are present.",
  );
}

/**
 * Strip the harmful single-template catch-all rewrite that points at
 * `/.netlify/functions/server`. Nitro declares `config.path: "/*"`, which
 * removes the default function URL, so rewriting to that URL publishes
 * Netlify platform 404s. Preserve any real redirects from `public/_redirects`.
 */
export function writeSingleTemplateNetlifyRedirects(projectCwd: string): void {
  const publishDir = path.join(projectCwd, "dist");
  const redirectsPath = path.join(publishDir, "_redirects");
  if (!fs.existsSync(redirectsPath)) return;

  const existing = fs.readFileSync(redirectsPath, "utf-8");
  const kept: string[] = [];
  let removed = 0;

  for (const line of existing.split(/\r?\n/)) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (
      normalized === NETLIFY_DEFAULT_FUNCTION_URL_REDIRECT ||
      normalized ===
        "# Generated by agent-native build for Netlify single-template deploys" ||
      normalized ===
        "# Static files are served first; dynamic routes fall through to the server function."
    ) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }

  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }

  if (removed === 0) return;

  if (kept.every((line) => line.trim() === "")) {
    fs.rmSync(redirectsPath, { force: true });
  } else {
    fs.writeFileSync(redirectsPath, kept.join("\n").trimEnd() + "\n");
  }
  console.log(
    '[deploy] Removed Netlify fallback rewrite to /.netlify/functions/server (incompatible with Nitro config.path: "/*").',
  );
}

function copyInstalledLibsqlNativePackages(serverDir: string | undefined) {
  if (!serverDir || !fs.existsSync(serverDir)) return;
  const nodeModulesRoots = nodeModulesAncestors(cwd);
  const destScopeDir = path.join(serverDir, "node_modules", "@libsql");
  let copied = 0;

  for (const packageName of LIBSQL_NATIVE_PACKAGE_NAMES) {
    if (!isServerlessNativePlatformPackage(packageName)) continue;
    const src = findInstalledLibsqlNativePackage(nodeModulesRoots, packageName);
    if (!src) continue;

    copyDir(src, path.join(destScopeDir, packageName));
    copied += 1;
  }

  if (copied > 0) {
    console.log(
      `[deploy] Copied ${copied} installed libsql native package(s) into the server bundle.`,
    );
  }
}

function copyInstalledResvgPackages(serverDir: string | undefined) {
  if (!serverDir || !fs.existsSync(serverDir)) return;
  // `resvg-js` itself is the JS wrapper that gets imported; everything else in
  // the scope is a per-platform prebuild.
  const packages = findInstalledResvgPackages(nodeModulesAncestors(cwd)).filter(
    ({ packageName }) =>
      packageName === RESVG_PACKAGE_PREFIX ||
      isServerlessNativePlatformPackage(packageName),
  );
  if (packages.length === 0) return;

  const destScopeDir = path.join(serverDir, "node_modules", RESVG_SCOPE);
  for (const { packageName, packageDir } of packages) {
    copyDir(packageDir, path.join(destScopeDir, packageName));
  }

  console.log(
    `[deploy] Copied ${packages.length} resvg package(s) into the server bundle for OG image rendering.`,
  );
}

function copyInstalledFfmpegStaticPackage(serverDir: string | undefined) {
  if (!serverDir || !fs.existsSync(serverDir)) return;
  const nodeModulesRoots = nodeModulesAncestors(cwd);
  if (!shouldBundleFfmpegStaticForServerless()) {
    if (hasInstalledFfmpegStaticPackage(nodeModulesRoots)) {
      console.warn(
        `[deploy] ffmpeg-static installs a ${process.platform}-${process.arch} binary, but the serverless runtime architecture is not known to match it; ` +
          "set AGENT_NATIVE_SERVERLESS_FFMPEG_ARCH=x64 or arm64 to bundle a matching binary, otherwise server-side media transcription fallback will require FFMPEG_PATH or a system ffmpeg.",
      );
    }
    return;
  }

  const src = findInstalledFfmpegStaticPackage(nodeModulesRoots);
  if (!src) {
    if (hasInstalledFfmpegStaticPackage(nodeModulesRoots)) {
      console.warn(
        "[deploy] ffmpeg-static is installed without a downloaded ffmpeg binary; " +
          "server-side media transcription fallback will require FFMPEG_PATH or a system ffmpeg.",
      );
    }
    return;
  }

  copyDir(
    src,
    path.join(serverDir, "node_modules", FFMPEG_STATIC_PACKAGE_NAME),
  );
  console.log(
    "[deploy] Copied ffmpeg-static into the server bundle for media transcription fallback.",
  );
}

/**
 * Nitro's file tracer can over-include optional desktop/dev packages that are
 * present in a monorepo install but cannot run in serverless. Netlify installs
 * the generated per-function package.json before upload; if `electron` remains
 * there, the function can exceed Netlify's 250 MB unzipped size limit even
 * though the server bundle never imports Electron at runtime.
 */
export function sanitizeServerlessFunctionPackageManifest(
  functionDir: string | undefined,
): void {
  if (!functionDir || !fs.existsSync(functionDir)) return;

  const packageJsonPath = path.join(functionDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;

  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return;
  }

  let removed = 0;
  for (const field of PACKAGE_DEPENDENCY_FIELDS) {
    const deps = packageJson[field];
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
    const depRecord = deps as Record<string, unknown>;
    for (const packageName of SERVERLESS_FUNCTION_PACKAGE_DENYLIST) {
      if (Object.prototype.hasOwnProperty.call(depRecord, packageName)) {
        delete depRecord[packageName];
        removed++;
      }
    }
    if (Object.keys(depRecord).length === 0) {
      delete packageJson[field];
    }
  }

  const nodeModulesDir = path.join(functionDir, "node_modules");
  for (const packageName of SERVERLESS_FUNCTION_PACKAGE_DENYLIST) {
    const packageDir = path.join(nodeModulesDir, ...packageName.split("/"));
    if (fs.existsSync(packageDir)) {
      fs.rmSync(packageDir, { recursive: true, force: true });
      removed++;
    }
  }

  if (removed > 0) {
    fs.writeFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    console.log(
      `[deploy] Removed ${removed} desktop-only package reference(s) from ${path.relative(cwd, functionDir)}.`,
    );
  }
}

/**
 * Nitro's dependency tracer is not subject to the copy-time filters above, so
 * it ships every prebuild of a multi-platform native package plus whatever the
 * local dev server left in `data/`. Prune both from the function dir before it
 * is cloned for the extra functions, since each clone is zipped and uploaded in
 * full.
 *
 * Only prunes inside a directory that still holds a runnable prebuild under the
 * `isServerlessNativePlatformPackage` naming (`@libsql`, `@resvg`). Packages
 * that name prebuilds differently — `@img/sharp-linux-x64` has no gnu/musl
 * suffix — read as entirely dead and must be left alone.
 */
export function pruneServerlessFunctionDeadWeight(
  functionDir: string | undefined,
): number {
  if (!functionDir || !fs.existsSync(functionDir)) return 0;

  let removedBytes = 0;
  const removedNames: string[] = [];
  const nodeModulesDir = path.join(functionDir, "node_modules");
  const packageDirs: string[] = [];
  if (fs.existsSync(nodeModulesDir)) {
    packageDirs.push(nodeModulesDir);
    for (const entry of fs.readdirSync(nodeModulesDir, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && entry.name.startsWith("@")) {
        packageDirs.push(path.join(nodeModulesDir, entry.name));
      }
    }
  }

  for (const packageDir of packageDirs) {
    const prebuilds = fs
      .readdirSync(packageDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          SERVERLESS_PLATFORM_PACKAGE_NAME.test(entry.name),
      )
      .map((entry) => entry.name);
    const runnable = prebuilds.filter(isServerlessNativePlatformPackage);
    if (runnable.length === 0) continue;

    for (const name of prebuilds) {
      if (isServerlessNativePlatformPackage(name)) continue;
      const deadDir = path.join(packageDir, name);
      removedBytes += getDirSize(deadDir);
      removedNames.push(path.relative(functionDir, deadDir));
      fs.rmSync(deadDir, { recursive: true, force: true });
    }

    const survivors = runnable.filter((name) =>
      fs.existsSync(path.join(packageDir, name)),
    );
    if (survivors.length === 0) {
      throw new Error(
        `[deploy] Pruning dead-platform prebuilds from ${path.relative(
          cwd,
          packageDir,
        )} removed every runnable Linux prebuild (had: ${runnable.join(", ")}).`,
      );
    }
  }

  const dataDir = path.join(functionDir, "data");
  if (fs.existsSync(dataDir)) {
    removedBytes += getDirSize(dataDir);
    removedNames.push("data");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (removedNames.length > 0) {
    console.log(
      `[deploy] Pruned ${removedNames.length} unrunnable path(s) (${(
        removedBytes /
        1024 /
        1024
      ).toFixed(
        1,
      )}MB) from ${path.relative(cwd, functionDir)}: ${removedNames.join(", ")}.`,
    );
  }
  return removedBytes;
}

/**
 * Create stub directories for dangling platform-specific optional dependency
 * symlinks in the pnpm store.
 *
 * pnpm's store at `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/<dep>`
 * contains symlinks for ALL optional deps declared by a package, but only
 * installs the ones matching the current OS/CPU as real packages. The other
 * symlinks dangle — their targets at `.pnpm/<scope>+<pkg>@<ver>/node_modules/...`
 * don't exist.
 *
 * Nitro's `nitro:externals` plugin (via nf3 / @vercel/nft) walks
 * optionalDependencies when tracing files and calls `realpath` on them, which
 * throws ENOENT on dangling targets. This blocks builds with presets like
 * netlify / vercel / aws-lambda on macOS when packages like `libsql` declare
 * Linux-only platform variants as optional deps.
 *
 * Fix: walk `node_modules/.pnpm/` and for every dangling symlink under
 * `<pkg>/node_modules/<scope>/<dep>`, create the symlink's target as a tiny
 * stub directory containing just a valid `package.json`. The tracer can now
 * `realpath` and read the package.json without throwing — the stub is empty
 * so no binary is bundled (which is what we want: we're building from macOS,
 * the target deploy platform will install its own native binary).
 */
function createDanglingOptionalDepStubs() {
  // In pnpm monorepos, the store may live at the workspace root rather than
  // in the template dir. Walk up from `cwd` to find every `.pnpm` directory.
  const pnpmRoots: string[] = [];
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".pnpm");
    if (fs.existsSync(candidate)) pnpmRoots.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (pnpmRoots.length === 0) return;

  let stubsCreated = 0;

  for (const pnpmRoot of pnpmRoots) {
    let pkgDirs: string[];
    try {
      pkgDirs = fs.readdirSync(pnpmRoot);
    } catch {
      continue;
    }

    for (const pkgDir of pkgDirs) {
      // e.g. `libsql@0.5.29`, `@libsql+client@0.15.15`
      const innerNm = path.join(pnpmRoot, pkgDir, "node_modules");
      if (!fs.existsSync(innerNm)) continue;

      let innerEntries: fs.Dirent[];
      try {
        innerEntries = fs.readdirSync(innerNm, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of innerEntries) {
        // Top-level entry: either `foo` (unscoped) or `@scope` (scoped)
        const entryPath = path.join(innerNm, entry.name);
        const candidates: { symlinkPath: string; pkgName: string }[] = [];
        if (entry.name.startsWith("@")) {
          // Scoped — iterate children
          let scopedChildren: fs.Dirent[];
          try {
            scopedChildren = fs.readdirSync(entryPath, {
              withFileTypes: true,
            });
          } catch {
            continue;
          }
          for (const child of scopedChildren) {
            candidates.push({
              symlinkPath: path.join(entryPath, child.name),
              pkgName: `${entry.name}/${child.name}`,
            });
          }
        } else {
          candidates.push({ symlinkPath: entryPath, pkgName: entry.name });
        }

        for (const { symlinkPath, pkgName } of candidates) {
          let isSymlink = false;
          try {
            isSymlink = fs.lstatSync(symlinkPath).isSymbolicLink();
          } catch {
            continue;
          }
          if (!isSymlink) continue;

          // Check if the symlink target exists
          try {
            fs.statSync(symlinkPath);
            continue; // Target exists — nothing to do
          } catch {
            // Dangling symlink — create a stub at the target
          }

          let linkTarget: string;
          try {
            linkTarget = fs.readlinkSync(symlinkPath);
          } catch {
            continue;
          }
          const resolvedTarget = path.resolve(
            path.dirname(symlinkPath),
            linkTarget,
          );

          try {
            fs.mkdirSync(resolvedTarget, { recursive: true });
            const stubPkgJson = {
              name: pkgName,
              version: "0.0.0-stub",
              description:
                "Empty stub created by @agent-native/core deploy build to satisfy nitro's file tracer on platforms where this optional dep is not installed.",
            };
            fs.writeFileSync(
              path.join(resolvedTarget, "package.json"),
              JSON.stringify(stubPkgJson, null, 2),
            );
            stubsCreated++;
          } catch {
            // Best-effort — ignore failures
          }
        }
      }
    }
  }

  if (stubsCreated > 0) {
    console.log(
      `[deploy] Created ${stubsCreated} stub package dir(s) for dangling optional deps (platform-specific binaries not installed on this host).`,
    );
  }
}

/**
 * Build for any non-Cloudflare preset using Nitro's programmatic build API.
 * Handles netlify, vercel, deno_deploy, aws-lambda, and all other targets.
 */
export interface NitroBuildHooks {
  prepare: (nitro: any) => Promise<void>;
  copyPublicAssets: (nitro: any) => Promise<void>;
  nitroBuild: (nitro: any) => Promise<void>;
}

export interface NitroBuildPipelineOptions {
  nitro: any;
  hooks: NitroBuildHooks;
  clientDir: string;
  publicOutputDir: string | undefined;
  appBasePath: string;
  cwd: string;
}

/**
 * Run Nitro's lifecycle in the order required to ship a working React Router
 * framework-mode build.
 *
 * The critical ordering constraint is that the React Router client build must
 * be copied into `publicOutputDir` *before* `nitroBuild` runs. Nitro generates
 * the static-asset manifest baked into the server bundle by globbing
 * `publicDir` during the server build; files copied in after that point exist
 * on disk but are invisible to the runtime `serveStatic` handler. Every
 * /assets/* request then falls through to the SSR catch-all, which 404s
 * anything with a file extension.
 */
export async function runNitroBuildPipeline(
  opts: NitroBuildPipelineOptions,
): Promise<void> {
  const { nitro, hooks, clientDir, publicOutputDir, appBasePath, cwd } = opts;
  const hasClientBuild = fs.existsSync(clientDir) && Boolean(publicOutputDir);

  if (hasClientBuild) {
    // Install hashed-asset route rules before Nitro prepares platform output.
    // Some presets materialize headers during prepare/copy phases, not only in
    // nitroBuild; adding these later leaves Netlify/Vercel static assets without
    // the one-year immutable CDN policy even though the runtime manifest works.
    nitro.options.routeRules ??= {};
    addImmutableAssetRouteRulesForClientBuild(
      nitro.options.routeRules,
      clientDir,
      appBasePath,
    );
  }

  await hooks.prepare(nitro);
  await hooks.copyPublicAssets(nitro);

  if (hasClientBuild && publicOutputDir) {
    copyDir(clientDir, publicOutputDir);
    if (
      appBasePath &&
      !publicDirIsMountedAtBasePath(publicOutputDir, appBasePath)
    ) {
      copyDir(clientDir, path.join(publicOutputDir, appBasePath.slice(1)));
    }
    console.log(
      `[deploy] Copied client assets to ${path.relative(cwd, publicOutputDir)}`,
    );
  }

  await hooks.nitroBuild(nitro);
}

/**
 * Nitro's serverless presets end `output.publicDir` in `{{ baseURL }}`
 * (netlify: `dist{{ baseURL }}`, vercel: `static{{ baseURL }}`, cloudflare:
 * `{{ output.dir }}{{ baseURL }}`), so for those the public dir already IS the
 * mount path. Mirroring again produced a whole second client build one level
 * deeper that nothing ever served — the workspace deploy only deleted it again.
 * Presets whose public dir is flat (`node-server`) still need the mirror.
 */
export function publicDirIsMountedAtBasePath(
  publicOutputDir: string,
  appBasePath: string,
): boolean {
  const mountSuffix = path.sep + appBasePath.slice(1).split("/").join(path.sep);
  return path.resolve(publicOutputDir).endsWith(mountSuffix);
}

/**
 * Browser-only diagram/drawing renderers that execute `window`-touching code at
 * module-evaluation time. They are rendered exclusively client-side — core's
 * `MermaidBlock` and templates' Excalidraw slides mount them inside `useEffect` /
 * `React.lazy`, never during SSR — so the server never needs the real module.
 *
 * Keep this list to libraries that are *provably never* invoked on the server.
 * Node-only deps that DO run server-side (pdf-parse, @google/genai, canvas, …)
 * must NOT go here — see `heavyClientExternals` for the edge-worker externals.
 */
const BROWSER_ONLY_SERVER_LIBS = [
  "@excalidraw/excalidraw",
  "@excalidraw/mermaid-to-excalidraw",
  "mermaid",
];

/**
 * Packages that Nitro can discover through the shared server graph but that
 * cannot be evaluated in a Cloudflare Worker. Keep the network-capable SDKs
 * real; these are limited to Node/native/browser-runtime packages whose
 * server-side paths already fail closed when the capability is unavailable.
 */
export const CLOUDFLARE_MODULE_STUB_MODULES = [
  "@napi-rs/canvas",
  "@resvg/resvg-js",
  "@sentry/node",
  "@sparticuz/chromium-min",
  "better-sqlite3",
  "chartjs-node-canvas",
  "chokidar",
  "fsevents",
  "node-pty",
  "playwright",
  "playwright-core",
] as const;

/**
 * Mirror the fail-closed package stubs used by the Pages bundler in Nitro's
 * Rolldown graph. Without this, the native module preset emits a valid module
 * graph that still crashes at Worker cold start when a Node-only optional
 * dependency is evaluated.
 */
export function createCloudflareModuleStubPlugin() {
  const stubbed = new Set<string>(CLOUDFLARE_MODULE_STUB_MODULES);
  const stubIdPrefix = "\0agent-native-cloudflare-module-stub:";

  return {
    name: "agent-native-cloudflare-module-stub",
    resolveId(id: string) {
      const packageName = id.startsWith("@")
        ? id.split("/").slice(0, 2).join("/")
        : id.split("/")[0];
      if (!stubbed.has(packageName) || id !== packageName) return null;
      return `${stubIdPrefix}${packageName}`;
    },
    load(id: string) {
      if (!id.startsWith(stubIdPrefix)) return null;
      const packageName = id.slice(stubIdPrefix.length);
      return CLOUDFLARE_WORKER_STUB_MODULES[packageName] ?? null;
    },
  };
}

/**
 * Dependencies Nitro itself must bundle outside the controlled Yjs output pass.
 * Node and controlled serverless presets keep Yjs external through Nitro;
 * `bundleYjsRuntimeForServerlessOutput` then creates their one portable copy.
 */
export const NITRO_SERVER_RUNTIME_BUNDLED_DEPS = ["yjs"] as const;

/**
 * Locate the core-owned ESM entry used by the controlled serverless bundling
 * pass. Resolving from this module keeps the build independent of whether a
 * template exposes core's transitive Yjs dependency at its own package root.
 */
export function resolveNitroBundledYjsEntry(): string {
  const requireFromCore = createRequire(import.meta.url);
  const packageDir = path.dirname(requireFromCore.resolve("yjs/package.json"));
  const entry = path.join(packageDir, "dist", "yjs.mjs");
  if (!fs.existsSync(entry)) {
    throw new Error(`[build] Could not resolve the Yjs ESM entry at ${entry}`);
  }
  return entry;
}

/**
 * Edge runtimes have no node_modules, while Node/serverless outputs receive the
 * small set above through the controlled post-build pass.
 */
export function nitroNoExternalsForPreset(
  targetPreset: string,
): true | readonly string[] {
  return targetPreset.startsWith("cloudflare") ||
    targetPreset.startsWith("deno")
    ? true
    : targetPreset === "netlify" ||
        targetPreset === "vercel" ||
        targetPreset === "aws-lambda" ||
        targetPreset === "node" ||
        targetPreset === "node-server"
      ? []
      : NITRO_SERVER_RUNTIME_BUNDLED_DEPS;
}

/**
 * Rolldown plugin for the Nitro server bundle that replaces the browser-only
 * renderers above with an inert proxy module.
 *
 * Why this is needed: Nitro re-bundles the server from node_modules with its own
 * Rolldown pipeline, and Rolldown merges Excalidraw into a SHARED vendor chunk
 * that the SSR render path (tiptap / radix-ui / recharts) imports *statically*.
 * That evaluates Excalidraw's top-level `window` access at function cold-start
 * and crashes every request with `ReferenceError: window is not defined` (HTTP
 * 502). The Vite SSR build already stubs these via `ssrStubPlugin` for
 * `build/server`, but that Vite plugin doesn't run during Nitro's separate
 * bundle — so mirror the same stub here.
 */
function createBrowserOnlyServerStubPlugin() {
  const stubbed = new Set(BROWSER_ONLY_SERVER_LIBS);
  const STUB_ID = "\0agent-native-browser-only-server-stub";
  return {
    name: "agent-native-browser-only-server-stub",
    // enforce: "pre" so we intercept before Nitro's node resolver bundles the
    // real package. defu concatenates rollupConfig.plugins ahead of Nitro's own.
    resolveId(id: string) {
      // Match the bare package name or any subpath (incl. `/index.css`).
      const pkg = id
        .split("/")
        .slice(0, id.startsWith("@") ? 2 : 1)
        .join("/");
      return stubbed.has(pkg) ? STUB_ID : null;
    },
    load(id: string) {
      if (id !== STUB_ID) return null;
      // A Proxy answers any property access (default or named) with another
      // proxy, so every import shape resolves without evaluating real browser
      // code. It is never actually invoked on the server, so it never throws.
      return (
        "const handler = { get(_t, p) {" +
        " if (p === Symbol.toPrimitive) return () => '';" +
        " if (p === 'then') return undefined;" +
        " if (p === '__esModule') return true;" +
        " return new Proxy(function () {}, handler); } };" +
        "const stub = new Proxy(function () {}, handler);" +
        "export default stub;"
      );
    },
  };
}

export function resolveNitroBuildReplacements(
  env: NodeJS.ProcessEnv = process.env,
  deploymentEnvironment?: string,
): Record<string, string> {
  const configuredDeploymentEnvironment =
    deploymentEnvironment?.trim() ||
    env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT?.trim();
  return {
    // Netlify exposes DEPLOY_ID only while building. Embed it into the Nitro
    // function so preview OAuth relays can target this immutable deployment
    // even though the value is unavailable in the function runtime.
    "process.env.AGENT_NATIVE_BUILD_ID": JSON.stringify(
      env.DEPLOY_ID?.trim() || env.AGENT_NATIVE_BUILD_ID?.trim() || "",
    ),
    "process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID": JSON.stringify(
      env.GA_MEASUREMENT_ID?.trim() || "",
    ),
    "process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID": JSON.stringify(
      env.GTM_CONTAINER_ID?.trim() || "",
    ),
    // Netlify's netlify.toml environment is available while this deploy
    // build runs, but is not injected into the deployed Function. Nitro is
    // a separate server build, so embed release migration ownership here as
    // well as in the Vite server bundle.
    "process.env.AGENT_NATIVE_RELEASE_MIGRATIONS": JSON.stringify(
      env.AGENT_NATIVE_RELEASE_MIGRATIONS?.trim() || "",
    ),
    "process.env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT": JSON.stringify(
      env.CONTEXT?.trim() || env.NETLIFY_CONTEXT?.trim() || "",
    ),
    ...(configuredDeploymentEnvironment
      ? {
          "process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT": JSON.stringify(
            configuredDeploymentEnvironment,
          ),
        }
      : {}),
  };
}

async function buildWithNitro() {
  console.log(`[deploy] Building for preset "${preset}" via Nitro...`);
  const appBasePath = normalizeConfiguredAppBasePath();

  // Nitro runs its own server build after the React Router/Vite build. The
  // template's agent-chat plugin imports .generated/actions-registry.ts so the
  // serverless bundle has static imports for every domain action. Regenerate
  // here as well so deploy builds are not coupled to a previous Vite run or to
  // ignored local .generated files being present.
  generateActionRegistryForProject(cwd);

  // Work around pnpm + nitro:externals (nf3) bug where dangling symlinks for
  // platform-specific optional deps cause realpath ENOENT during file tracing.
  createDanglingOptionalDepStubs();

  const {
    createNitro,
    prepare,
    copyPublicAssets,
    build: nitroBuild,
  } = await import("nitro/builder");

  // Resolve the React Router server build so the SSR catch-all route
  // can import "virtual:react-router/server-build" in production.
  const rrServerBuild = path.join(cwd, "build", "server", "index.js");

  // Inline the template's AGENTS.md + .agents/skills/ content into the Nitro
  // bundle via the `virtual` config option. Nitro's internal `nitro:virtual`
  // Rollup plugin picks this up and resolves `virtual:agents-bundle` to the
  // generated ES module source. Without this, Nitro's Rolldown build (used for
  // netlify, vercel, aws-lambda, node presets) can't resolve the virtual
  // module that `server/agents-bundle.ts` imports — it silently falls through
  // to an empty bundle and the agent gets no instructions/skills at runtime.
  //
  // The Vite plugin at `vite/agents-bundle-plugin.ts` handles this for the
  // React Router client/server build (and cloudflare via esbuild rebundle),
  // but Nitro runs its OWN build from ./server/ without Vite, so it needs its
  // own virtual module registration. Both paths reuse `readAgentsBundleFromFs`
  // from `server/agents-bundle.ts` to guarantee identical content.
  const { readAgentsBundleFromFs } = await import("../server/agents-bundle.js");
  const nitroAgentConfig = await loadResolvedAgentNativeConfig(
    cwd,
    createAgentNativeConfigContext(
      "build",
      process.env.NODE_ENV === "development" ? "development" : "production",
    ),
  );
  // Resolve the workspace core (if present) up front so the bundle embeds
  // enterprise-wide AGENTS.md + skills alongside the template's.
  const nitroWorkspaceCore = await getWorkspaceCoreExports(cwd);
  const nitroWorkspaceSource = nitroWorkspaceCore
    ? {
        skillsDir: nitroWorkspaceCore.skillsDir,
        agentsMdPath: nitroWorkspaceCore.agentsMdPath,
        rootDir: nitroWorkspaceCore.packageDir,
      }
    : null;
  const agentsBundleModuleSource = () => {
    const bundle = readAgentsBundleFromFs(cwd, nitroWorkspaceSource, {
      instructions: nitroAgentConfig.instructions,
    });
    return `// AUTO-GENERATED by @agent-native/core deploy build (Nitro virtual)
// Contains the inlined AGENTS.md + .agents/skills/ content from the template,
// merged with the workspace core's AGENTS.md + skills/ when present.
const bundle = ${JSON.stringify(bundle)};
export default bundle;
`;
  };

  // Path aliases used by templates (mirrors tsconfig + Vite config). Nitro
  // bundles server/ and actions/ with its own Rolldown pipeline that doesn't
  // see Vite's resolve.alias — so without this, action files that import
  // `@/foo` (= `app/foo`) end up with the literal `@/foo` specifier in the
  // serverless function output and crash at runtime with
  // "Cannot find package '@/foo' imported from /var/task/main.mjs".
  const appDir = path.join(cwd, "app");
  const sharedDir = path.join(cwd, "shared");
  const pathAliases: Record<string, string> = {};
  if (fs.existsSync(appDir)) pathAliases["@"] = appDir;
  if (fs.existsSync(sharedDir)) pathAliases["@shared"] = sharedDir;

  const providedPluginsNitroPlugin = await writeProvidedPluginsNitroPlugin();

  const nitro = await createNitro({
    rootDir: cwd,
    dev: false,
    preset,
    baseURL: appBasePath || "/",
    minify: true,
    serverDir: "./server",
    ignore: NITRO_RUNTIME_IGNORE_PATTERNS,
    alias: {
      ...pathAliases,
      ...(fs.existsSync(rrServerBuild)
        ? { "virtual:react-router/server-build": rrServerBuild }
        : {}),
    },
    virtual: {
      "virtual:agents-bundle": agentsBundleModuleSource,
    },
    replace: resolveNitroBuildReplacements(
      process.env,
      nitroAgentConfig.deployment?.environment,
    ),
    // Replace browser-only renderers (Excalidraw/Mermaid) with an inert proxy in
    // the server bundle. Without this, Nitro's Rolldown build pulls the real
    // Excalidraw into a shared vendor chunk imported statically by the SSR render
    // path, and its top-level `window` access crashes the function at cold-start
    // (ReferenceError: window is not defined → every request 502s). Mirrors the
    // Vite `ssrStubPlugin`, which only covers the `build/server` step.
    rollupConfig: {
      // Nitro treats the intermediate React Router SSR files as prebuilt
      // chunks, while core's server collaboration files participate in the
      // final Rolldown graph. Externalize Yjs consistently on Node/serverless so
      // both graphs retain their public import shapes; the controlled
      // post-build pass below bundles and rewrites them to one module.
      ...(preset === "netlify" ||
      preset === "vercel" ||
      preset === "aws-lambda" ||
      preset === "node" ||
      preset === "node-server"
        ? { external: ["yjs"] }
        : {}),
      plugins: [
        ...(preset.startsWith("cloudflare")
          ? [createCloudflareModuleStubPlugin()]
          : []),
        createBrowserOnlyServerStubPlugin(),
      ],
    },
    ...(providedPluginsNitroPlugin
      ? { plugins: [providedPluginsNitroPlugin] }
      : {}),
    routeRules: mcpEmbedStaticAssetRouteRules(appBasePath),
    // Edge presets (cloudflare, deno) bundle all deps because node_modules are
    // unavailable at runtime. Node and controlled serverless presets
    // externalize Yjs above, then emit one full runtime module after Nitro has
    // preserved every consumer's public imports.
    noExternals: nitroNoExternalsForPreset(preset),
  } as any);

  await runNitroBuildPipeline({
    nitro,
    hooks: { prepare, copyPublicAssets, nitroBuild },
    clientDir: path.join(cwd, "build", "client"),
    publicOutputDir: nitro.options.output.publicDir,
    appBasePath,
    cwd,
  });

  if (isCloudflareModulePreset(preset)) {
    configureCloudflareModuleWorkerOutput(nitro.options.output.serverDir);
  }

  if (preset === "netlify" || preset === "vercel" || preset === "aws-lambda") {
    copyInstalledLibsqlNativePackages(nitro.options.output.serverDir);
    copyInstalledResvgPackages(nitro.options.output.serverDir);
    copyInstalledFfmpegStaticPackage(nitro.options.output.serverDir);
    copyInstalledBrowserRuntimePackages(nitro.options.output.serverDir);
    sanitizeServerlessFunctionPackageManifest(nitro.options.output.serverDir);
    // Before the Netlify block below clones this dir into the extra functions,
    // so they inherit the pruned bundle instead of a second full copy.
    pruneServerlessFunctionDeadWeight(nitro.options.output.serverDir);
  }

  if (shouldBundleYjsRuntimeForPreset(preset)) {
    bundleYjsRuntimeForServerlessOutput(nitro.options.output.serverDir, cwd);
  }

  if (isCloudflareModulePreset(preset)) {
    bundleYjsRuntimeForServerlessOutput(nitro.options.output.serverDir, cwd);
  }

  if (preset === "netlify") {
    // Durable background agent runs are default-on for Netlify; a falsy
    // AGENT_CHAT_DURABLE_BACKGROUND value opts out. Additive ONLY: emits a
    // SECOND Netlify function whose name ends in `-background` re-exporting the
    // same handler bundle, so the chat `_process-run` POST lands on Netlify's
    // async (15-min) function. When opted out this is a no-op and the
    // single-function deploy is byte-for-byte unchanged.
    // NOT wrapped in try/catch: this block only runs when the runtime depends
    // on the function, and a swallowed failure ships an app that loses the
    // background budget for the life of the deploy with nothing in the log.
    if (isDurableBackgroundEmitRequired()) {
      emitSingleTemplateNetlifyBackgroundFunction(cwd);
    }

    emitSingleTemplateNetlifyRecurringJobsFunction(cwd);

    // Emit keep-warm after the background artifact so it only pings a function
    // that this build actually produced.
    emitSingleTemplateNetlifyKeepWarmFunction(cwd);

    if (isIntegrationDurableDispatchDeployEnabled()) {
      try {
        emitSingleTemplateNetlifyIntegrationRecoveryFunction(cwd);
      } catch (err) {
        console.warn(
          "[build] Failed to emit integration recovery Netlify function (non-fatal):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    writeSingleTemplateNetlifyRedirects(cwd);
    assertSingleTemplateNetlifyBuildOutput(cwd);
  }

  // Resolve remaining bare npm imports by bundling them into _libs/.
  // Nitro sometimes leaves small packages as externals even with noExternals.
  if (preset.startsWith("cloudflare") || preset.startsWith("deno")) {
    const { execFileSync } = await import("child_process");
    const { createRequire } = await import("module");
    const esbuildBin = (() => {
      try {
        const _req = createRequire(cwd + "/");
        const pkg = path.dirname(_req.resolve("esbuild/package.json"));
        const bin = path.join(pkg, "bin", "esbuild");
        if (fs.existsSync(bin)) return bin;
      } catch {}
      return "esbuild";
    })();

    // Scan all output files for bare npm imports
    const outputDir =
      nitro.options.output.serverDir || path.join(cwd, "dist", "_worker.js");
    const bareImports = new Set<string>();
    function scanForBareImports(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanForBareImports(p);
          continue;
        }
        if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
          continue;
        const code = fs.readFileSync(p, "utf-8");
        const matches = code.matchAll(/from\s*["']([a-z@][a-z0-9._\-/]*)["']/g);
        for (const m of matches) {
          const mod = m[1];
          if (mod.startsWith("node:")) continue;
          // Skip Node builtins that are available via nodejs_compat
          const builtins = new Set([
            "fs",
            "path",
            "os",
            "crypto",
            "http",
            "https",
            "stream",
            "url",
            "util",
            "events",
            "buffer",
            "console",
            "net",
            "tls",
            "assert",
            "timers",
            "child_process",
            "module",
            "process",
            "sqlite",
            "worker_threads",
            "querystring",
            "zlib",
            "vm",
            "string_decoder",
            "diagnostics_channel",
            "async_hooks",
            "perf_hooks",
            "inspector",
          ]);
          if (builtins.has(mod)) continue;
          bareImports.add(mod);
        }
      }
    }
    scanForBareImports(outputDir);

    // For each bare import, try to bundle it as a standalone module
    if (bareImports.size > 0) {
      const libsDir = path.join(outputDir, "_libs");
      fs.mkdirSync(libsDir, { recursive: true });
      function rewriteExternalImports(mod: string, outFile: string) {
        function rewriteImports(dir: string) {
          if (!fs.existsSync(dir)) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              rewriteImports(p);
              continue;
            }
            if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
              continue;
            const code = fs.readFileSync(p, "utf8");
            const relPath = path
              .relative(path.dirname(p), outFile)
              .replace(/\\/g, "/");
            const importPath = relPath.startsWith(".")
              ? relPath
              : "./" + relPath;
            const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`from["']${escaped}["']`, "g");
            const rewritten = code.replace(re, `from"${importPath}"`);
            if (rewritten !== code) fs.writeFileSync(p, rewritten);
          }
        }
        rewriteImports(outputDir);
      }
      for (const mod of bareImports) {
        const outFile = path.join(libsDir, `${mod.replace(/[/@]/g, "_")}.mjs`);
        // Nitro may already have emitted a correctly minified module wrapper
        // for this dependency. Replacing that wrapper with an esbuild CJS
        // adapter loses its public export aliases and makes otherwise valid
        // sibling chunks fail during Worker module linking.
        if (fs.existsSync(outFile)) {
          console.log(`[deploy] Retaining Nitro external: ${mod}`);
          rewriteExternalImports(mod, outFile);
          continue;
        }
        try {
          // Resolve the module — check workspace node_modules and pnpm store
          let resolvedMod = mod;
          const _require = createRequire(cwd + "/");
          try {
            const resolved = _require.resolve(mod);
            resolvedMod = resolved;
          } catch {
            // Try from workspace root
            try {
              const wsRequire = createRequire(
                path.resolve(cwd, "../../package.json"),
              );
              resolvedMod = wsRequire.resolve(mod);
            } catch {
              // Will fail at esbuild
            }
          }
          // Scan what named imports the consumer expects, then generate
          // explicit re-exports to handle CJS modules properly.
          const neededExports = new Set<string>();
          function findNeededExports(dir: string) {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findNeededExports(p);
                continue;
              }
              if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
                continue;
              const code = fs.readFileSync(p, "utf-8");
              // Match: import{foo as bar,baz}from"<mod>"
              const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const re = new RegExp(
                `import\\{([^}]+)\\}from["']${escaped}["']`,
                "g",
              );
              for (const m2 of code.matchAll(re)) {
                for (const part of m2[1].split(",")) {
                  const name = part
                    .trim()
                    .split(/\s+as\s+/)[0]
                    .trim();
                  if (name && /^[a-zA-Z_$]/.test(name)) neededExports.add(name);
                }
              }
            }
          }
          findNeededExports(outputDir);

          const entryCode =
            neededExports.size > 0
              ? [
                  `import _mod from "${resolvedMod}";`,
                  `export default _mod;`,
                  ...Array.from(neededExports).map(
                    (n) =>
                      `export const ${n} = _mod.${n} ?? _mod?.default?.${n};`,
                  ),
                ].join("\n")
              : `export * from "${resolvedMod}"; export { default } from "${resolvedMod}";`;

          execFileSync(
            esbuildBin,
            [
              "--bundle",
              `--outfile=${outFile}`,
              "--format=esm",
              "--platform=neutral",
              "--target=es2022",
              "--external:node:*",
            ],
            {
              input: entryCode,
              cwd,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          // Rewrite imports in all files to point to the bundled module
          function rewriteImports(dir: string) {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                rewriteImports(p);
                continue;
              }
              if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
                continue;
              let code = fs.readFileSync(p, "utf-8");
              const relPath = path
                .relative(path.dirname(p), outFile)
                .replace(/\\/g, "/");
              const importPath = relPath.startsWith(".")
                ? relPath
                : "./" + relPath;
              const re = new RegExp(
                `from["']${mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
                "g",
              );
              if (re.test(code)) {
                code = code.replace(re, `from"${importPath}"`);
                fs.writeFileSync(p, code);
              }
            }
          }
          rewriteImports(outputDir);
          console.log(`[deploy] Bundled external: ${mod}`);
        } catch {
          console.warn(
            `[deploy] Could not bundle: ${mod} (may not be needed at runtime)`,
          );
        }
      }
    }
  }

  // Cloudflare-specific post-build patches
  if (preset.startsWith("cloudflare")) {
    const serverDir2 = nitro.options.output.serverDir;
    const scanDirs = [serverDir2];
    if (serverDir2) {
      const chunksDir = path.join(serverDir2, "_chunks");
      const libsDir = path.join(serverDir2, "_libs");
      if (fs.existsSync(chunksDir)) scanDirs.push(chunksDir);
      if (fs.existsSync(libsDir)) scanDirs.push(libsDir);
    }

    for (const scanDir of scanDirs) {
      if (!scanDir || !fs.existsSync(scanDir)) continue;
      for (const file of fs.readdirSync(scanDir)) {
        if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
        const filePath = path.join(scanDir, file);
        let code = fs.readFileSync(filePath, "utf-8");
        let changed = false;

        // 1. Rewrite bare Node.js imports to node: prefixed.
        // CF Workers requires the node: prefix for built-in modules.
        const NODE_BUILTINS = [
          "fs",
          "path",
          "os",
          "crypto",
          "http",
          "https",
          "stream",
          "url",
          "util",
          "events",
          "buffer",
          "console",
          "querystring",
          "zlib",
          "net",
          "tls",
          "assert",
          "timers",
          "child_process",
          "module",
          "process",
          "sqlite",
          "worker_threads",
          "string_decoder",
          "diagnostics_channel",
          "async_hooks",
          "perf_hooks",
          "inspector",
          "vm",
        ];
        for (const mod of NODE_BUILTINS) {
          // Match: from"fs" or from "fs" (but not from"node:fs")
          const re = new RegExp(`from\\s*["']${mod}["']`, "g");
          if (re.test(code)) {
            code = code.replace(re, `from"node:${mod}"`);
            changed = true;
          }
        }

        // 2. Patch import.meta.url for createRequire().
        // React Router's server build uses createRequire(import.meta.url)
        // but import.meta.url is undefined on CF Workers.
        if (code.includes("import.meta.url")) {
          code = code.replace(/import\.meta\.url/g, '"file:///worker.mjs"');
          changed = true;
        }

        // 3. Patch setInterval/setTimeout at global scope.
        // CF Workers disallows timers in global scope.
        if (code.includes("setInterval") && !code.includes("__timer_shim__")) {
          const shim =
            "/* __timer_shim__ */" +
            "var __origSetInterval=globalThis.setInterval;" +
            "globalThis.setInterval=function(){return{unref(){},ref(){},close(){}}};";
          const restore =
            ";(function(){if(typeof __origSetInterval!=='undefined')globalThis.setInterval=__origSetInterval})();";
          code = shim + code + "\n" + restore;
          changed = true;
        }

        if (changed) fs.writeFileSync(filePath, code);
      }
    }
    // 3. Create stub modules in _libs/ for native deps that Nitro's rolldown
    // bundler references but can't resolve on CF Workers, and rewrite
    // bare imports to point to the stub files.
    const libsDir2 = path.join(
      serverDir2 || path.join(cwd, "dist", "_worker.js"),
      "_libs",
    );
    if (fs.existsSync(libsDir2)) {
      const NATIVE_STUBS = ["better-sqlite3", "node-pty", "cron-parser"];
      for (const mod of NATIVE_STUBS) {
        const libFiles = fs
          .readdirSync(libsDir2)
          .filter((f) => f.endsWith(".mjs"));
        const referencingFiles: string[] = [];
        for (const f of libFiles) {
          const filePath = path.join(libsDir2, f);
          const content = fs.readFileSync(filePath, "utf-8");
          if (content.includes(`"${mod}"`) || content.includes(`'${mod}'`)) {
            referencingFiles.push(filePath);
          }
        }
        if (referencingFiles.length === 0) continue;

        // Create a stub _libs/<mod>.mjs that exports empty defaults
        const stubName = mod.replace(/[/@]/g, "__") + ".mjs";
        const stubPath = path.join(libsDir2, stubName);
        if (!fs.existsSync(stubPath)) {
          fs.writeFileSync(
            stubPath,
            `export default {}; export const watch = () => ({ close() {} });\n`,
          );
          console.log(`[deploy] Created stub for _libs/${stubName}`);
        }

        // Rewrite bare imports in _libs/ and _chunks/ to use the stub
        const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const importRe = new RegExp(`(from\\s*["'])${escaped}(["'])`, "g");
        // Scan _libs/ files
        for (const filePath of referencingFiles) {
          let code = fs.readFileSync(filePath, "utf-8");
          if (importRe.test(code)) {
            code = code.replace(importRe, `$1./${stubName}$2`);
            fs.writeFileSync(filePath, code);
            console.log(
              `[deploy] Rewrote ${mod} imports in _libs/${path.basename(filePath)}`,
            );
          }
        }
        // Also scan _chunks/ files (they import native deps too)
        const chunksDir2 = path.join(
          serverDir2 || path.join(cwd, "dist", "_worker.js"),
          "_chunks",
        );
        if (fs.existsSync(chunksDir2)) {
          for (const f of fs
            .readdirSync(chunksDir2)
            .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"))) {
            const filePath = path.join(chunksDir2, f);
            let code = fs.readFileSync(filePath, "utf-8");
            if (importRe.test(code)) {
              // From _chunks/, the stub is at ../_libs/<stubName>
              code = code.replace(importRe, `$1../_libs/${stubName}$2`);
              fs.writeFileSync(filePath, code);
              console.log(`[deploy] Rewrote ${mod} imports in _chunks/${f}`);
            }
          }
        }
      }
    }

    console.log(
      "[deploy] Patched bare Node imports, timer calls, and route finder for CF Workers",
    );
  }

  await nitro.close();
  console.log(`[deploy] Nitro build complete for preset "${preset}".`);
}

async function main() {
  console.log(`[deploy] Building for ${preset}...`);

  switch (preset) {
    case "cloudflare_pages":
    case "cloudflare-pages":
      // Cloudflare Workers require a single-file bundle that wrangler can deploy.
      // Nitro's native presets produce split chunks that wrangler can't upload
      // as multi-module Workers. Use the custom esbuild-based bundler.
      await buildCloudflarePages();
      break;
    case "cloudflare_module":
    case "cloudflare-module":
      await buildWithNitro();
      break;
    default:
      // All other presets (netlify, vercel, deno_deploy, aws-lambda, etc.)
      // are handled natively by Nitro's build API.
      await buildWithNitro();
      break;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
