import path from "path";
import fs from "fs";
import { createRequire } from "module";
import type { IncomingMessage, ServerResponse } from "http";
import type { Plugin, UserConfig } from "vite";
import { nitro as nitroVitePlugin } from "nitro/vite";
import { actionTypesPlugin } from "./action-types-plugin.js";
import { agentsBundlePlugin } from "./agents-bundle-plugin.js";
import { findWorkspaceRoot } from "../scripts/utils.js";
import { getViteDevRecoveryScript } from "../client/vite-dev-recovery-script.js";
import { verifyEmbedSessionToken } from "../server/embed-session.js";
import {
  EMBED_SESSION_COOKIE,
  EMBED_TOKEN_QUERY_PARAM,
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  isMcpEmbedCorsOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  MCP_EMBED_STATIC_ASSET_HEADERS,
  mcpEmbedStaticAssetRouteRules,
} from "../shared/mcp-embed-headers.js";

import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Sync discovery for the workspace-core in an enterprise monorepo.
 *
 * Mirrors `getWorkspaceCoreExports` in deploy/workspace-core.ts but stays
 * synchronous so it can run inline in `defineConfig`. Returns the workspace
 * core's package name + absolute directory, or null if no workspace core is
 * declared in the ancestor chain.
 *
 * Walks up from `startDir` looking for a package.json with
 * `agent-native.workspaceCore`. Resolves the declared package name through
 * `<workspaceRoot>/node_modules/<name>` (pnpm symlink, fastest) or by
 * scanning `packages/*` for a matching `name` field (fallback for
 * pre-install scenarios).
 */
function findWorkspaceCoreSync(
  startDir: string,
): { packageName: string; packageDir: string } | null {
  // 1) Walk up looking for the root package.json that declares workspaceCore.
  let dir = path.resolve(startDir);
  let workspaceRoot: string | null = null;
  let packageName: string | null = null;
  for (let i = 0; i < 20; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const declared = pkg?.["agent-native"]?.workspaceCore;
        if (typeof declared === "string" && declared.length > 0) {
          workspaceRoot = dir;
          packageName = declared;
          break;
        }
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!workspaceRoot || !packageName) return null;

  // 2a) pnpm/npm symlink under workspaceRoot/node_modules.
  const nm = path.join(workspaceRoot, "node_modules", packageName);
  if (fs.existsSync(path.join(nm, "package.json"))) {
    return { packageName, packageDir: fs.realpathSync(nm) };
  }

  // 2b) Scan packages/* and packages/@scope/* for a matching `name`.
  const packagesDir = path.join(workspaceRoot, "packages");
  if (fs.existsSync(packagesDir)) {
    const candidates: string[] = [];
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packagesDir, entry.name));
      if (entry.name.startsWith("@")) {
        const scopeDir = path.join(packagesDir, entry.name);
        for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
          if (sub.isDirectory()) candidates.push(path.join(scopeDir, sub.name));
        }
      }
    }
    for (const c of candidates) {
      const p = path.join(c, "package.json");
      if (!fs.existsSync(p)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (pkg?.name === packageName)
          return { packageName, packageDir: fs.realpathSync(c) };
      } catch {
        // ignore malformed package.json
      }
    }
  }
  return null;
}

/** Escape a string so it can be embedded as a regex literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check if a package is installed in the project */
function hasDep(pkg: string, cwd: string): boolean {
  try {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    );
    return !!(
      pkgJson.dependencies?.[pkg] ||
      pkgJson.devDependencies?.[pkg] ||
      pkgJson.peerDependencies?.[pkg]
    );
  } catch {
    return false;
  }
}

/**
 * Build the `resolve.dedupe` list dynamically. Reads core's package.json and
 * collects every peerDependency that the consuming app also declares. This
 * ensures Vite resolves them from the app root, not from core's own
 * node_modules — preventing duplicate React context / singleton issues.
 */
function getClientDedupe(cwd: string): string[] {
  // Always dedupe React internals (sub-path exports aren't in peerDeps)
  const always = new Set(["react", "react-dom", "react-dom/client"]);

  // Server-only packages that never run in the browser — no point deduping.
  const serverOnly = new Set([
    "drizzle-kit",
    "node-pty",
    "postgres",
    "ws",
    "typescript",
    "vite",
    "@vitejs/plugin-react-swc",
    "tailwindcss",
    "@tailwindcss/vite",
  ]);

  try {
    const corePkgPath = path.resolve(__dirname, "../../package.json");
    const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf-8"));

    // Scan both peerDependencies and dependencies. Direct deps like
    // @radix-ui/* use React internally — they must resolve against the
    // app's React, not a second copy inside core's node_modules.
    const coreDeps = new Set([
      ...Object.keys(corePkg.peerDependencies ?? {}),
      ...Object.keys(corePkg.dependencies ?? {}),
    ]);

    // Read the consuming app's dependencies
    const appPkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
    );
    const appDeps = new Set([
      ...Object.keys(appPkg.dependencies ?? {}),
      ...Object.keys(appPkg.devDependencies ?? {}),
    ]);

    for (const dep of coreDeps) {
      if (serverOnly.has(dep)) continue;
      // Dedupe if the app also declares it, OR if it's a React-based
      // UI library (Radix, Tanstack) that must share the app's React.
      if (
        appDeps.has(dep) ||
        dep.startsWith("@radix-ui/") ||
        dep.startsWith("@tanstack/")
      ) {
        always.add(dep);
      }
    }
  } catch {
    // Can't read package.json — fall back to known singletons
  }

  return [...always];
}

/**
 * Locate `packages/core/src` if we're inside the framework monorepo.
 * Shared between `getCoreSourceAliases` (which redirects imports to src/)
 * and `getDefaultOptimizeDeps` (which must NOT prebundle from dist/ when
 * the alias is active — otherwise the prebundle is built from a snapshot
 * of dist/ at startup and never picks up new exports).
 */
function findCoreSrcDir(cwd: string): string | null {
  const candidates = [
    path.resolve(cwd, "../../packages/core"), // templates/<name>/
    path.resolve(cwd, "../core"), // packages/<name>/
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src/index.ts"))) {
      return path.join(candidate, "src");
    }
  }
  return null;
}

/**
 * Every `@agent-native/core` subpath that gets a source alias. Must stay in
 * sync with `getCoreSourceAliases`. Used by `getDefaultOptimizeDeps` to skip
 * prebundling in monorepo mode, and by the consumer config to add them to
 * `optimizeDeps.exclude` so Vite always resolves them through the source
 * alias on every request — never from a stale dist/ snapshot.
 */
const CORE_CLIENT_SUBPATHS = [
  "@agent-native/core",
  "@agent-native/core/client",
  "@agent-native/core/client/extensions",
  "@agent-native/core/client/tools", // legacy alias
  "@agent-native/core/client/org",
  "@agent-native/core/client/db-admin",
  "@agent-native/core/client/observability",
  "@agent-native/core/client/onboarding",
  "@agent-native/core/client/sharing",
  "@agent-native/core/client/notifications",
  "@agent-native/core/client/progress",
  "@agent-native/core/client/transcription/use-live-transcription",
];

function getDefaultOptimizeDeps(cwd: string): string[] {
  const inMonorepo = findCoreSrcDir(cwd) !== null;
  const entries: Array<{ specifier: string; packageName?: string }> = [
    // In monorepo mode the source alias resolves these to src/ on every
    // import, so prebundling from dist/ would just create a stale snapshot.
    // Skip them entirely — `optimizeDeps.exclude` below makes that explicit.
    ...(inMonorepo
      ? []
      : ([
          { specifier: "@agent-native/core" },
          {
            specifier: "@agent-native/core/client",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/org",
            packageName: "@agent-native/core",
          },
          {
            specifier: "@agent-native/core/client/extensions",
            packageName: "@agent-native/core",
          },
          {
            // Legacy alias — prior name for @agent-native/core/client/extensions.
            // Keep so deployed templates that haven't been updated still resolve.
            specifier: "@agent-native/core/client/tools",
            packageName: "@agent-native/core",
          },
        ] as Array<{ specifier: string; packageName?: string }>)),
    { specifier: "@libsql/client" },
    { specifier: "@radix-ui/react-accordion" },
    { specifier: "@radix-ui/react-alert-dialog" },
    { specifier: "@radix-ui/react-avatar" },
    { specifier: "@radix-ui/react-checkbox" },
    { specifier: "@radix-ui/react-collapsible" },
    { specifier: "@radix-ui/react-context-menu" },
    { specifier: "@radix-ui/react-dialog" },
    { specifier: "@radix-ui/react-dropdown-menu" },
    { specifier: "@radix-ui/react-hover-card" },
    { specifier: "@radix-ui/react-label" },
    { specifier: "@radix-ui/react-menubar" },
    { specifier: "@radix-ui/react-navigation-menu" },
    { specifier: "@radix-ui/react-popover" },
    { specifier: "@radix-ui/react-progress" },
    { specifier: "@radix-ui/react-radio-group" },
    { specifier: "@radix-ui/react-scroll-area" },
    { specifier: "@radix-ui/react-select" },
    { specifier: "@radix-ui/react-separator" },
    { specifier: "@radix-ui/react-slider" },
    { specifier: "@radix-ui/react-slot" },
    { specifier: "@radix-ui/react-switch" },
    { specifier: "@radix-ui/react-tabs" },
    { specifier: "@radix-ui/react-toast" },
    { specifier: "@radix-ui/react-toggle" },
    { specifier: "@radix-ui/react-toggle-group" },
    { specifier: "@radix-ui/react-tooltip" },
    { specifier: "@tanstack/react-query" },
    { specifier: "@tabler/icons-react" },
    { specifier: "class-variance-authority" },
    { specifier: "clsx" },
    { specifier: "cmdk" },
    { specifier: "drizzle-orm" },
    { specifier: "drizzle-orm/pg-core", packageName: "drizzle-orm" },
    { specifier: "drizzle-orm/sqlite-core", packageName: "drizzle-orm" },
    { specifier: "h3" },
    { specifier: "next-themes" },
    { specifier: "react-hook-form" },
    { specifier: "sonner" },
    { specifier: "tailwind-merge" },
    { specifier: "zod" },
  ];

  return entries
    .filter(({ specifier, packageName }) =>
      hasDep(packageName ?? specifier, cwd),
    )
    .map(({ specifier }) => specifier);
}

/**
 * In monorepo dev mode, resolve @agent-native/core imports to source (src/)
 * instead of dist/ so that Vite HMR picks up changes without rebuilding.
 *
 * Returns Vite array-style aliases with exact matching (regex anchored with $)
 * to prevent `@agent-native/core` from prefix-matching and swallowing
 * sub-path imports like `@agent-native/core/client`.
 */
function getCoreSourceAliases(
  cwd: string,
): Array<{ find: RegExp; replacement: string }> {
  const coreSrc = findCoreSrcDir(cwd);
  if (!coreSrc) return []; // Not in monorepo — use dist as normal

  // Map every @agent-native/core/* export to its src/ equivalent.
  // Each entry uses a regex with $ anchor for exact matching.
  const entries: Record<string, string> = {
    "@agent-native/core": path.join(coreSrc, "index.browser.ts"),
    "@agent-native/core/server": path.join(coreSrc, "server/index.ts"),
    "@agent-native/core/client": path.join(coreSrc, "client/index.ts"),
    "@agent-native/core/client/extensions": path.join(
      coreSrc,
      "client/extensions/index.ts",
    ),
    // Legacy alias — see exports map note above.
    "@agent-native/core/client/tools": path.join(
      coreSrc,
      "client/extensions/index.ts",
    ),
    "@agent-native/core/client/org": path.join(coreSrc, "client/org/index.ts"),
    "@agent-native/core/client/db-admin": path.join(
      coreSrc,
      "client/db-admin/index.ts",
    ),
    "@agent-native/core/client/observability": path.join(
      coreSrc,
      "client/observability/index.ts",
    ),
    "@agent-native/core/client/onboarding": path.join(
      coreSrc,
      "client/onboarding/index.ts",
    ),
    "@agent-native/core/client/sharing": path.join(
      coreSrc,
      "client/sharing/index.ts",
    ),
    "@agent-native/core/client/notifications": path.join(
      coreSrc,
      "client/notifications/index.ts",
    ),
    "@agent-native/core/client/progress": path.join(
      coreSrc,
      "client/progress/index.ts",
    ),
    "@agent-native/core/client/transcription/use-live-transcription": path.join(
      coreSrc,
      "client/transcription/use-live-transcription.ts",
    ),
    "@agent-native/core/db": path.join(coreSrc, "db/index.ts"),
    "@agent-native/core/db/schema": path.join(coreSrc, "db/schema.ts"),
    "@agent-native/core/shared": path.join(coreSrc, "shared/index.ts"),
    "@agent-native/core/scripts": path.join(coreSrc, "scripts/index.ts"),
    "@agent-native/core/application-state": path.join(
      coreSrc,
      "application-state/index.ts",
    ),
    "@agent-native/core/settings": path.join(coreSrc, "settings/index.ts"),
    "@agent-native/core/credentials": path.join(
      coreSrc,
      "credentials/index.ts",
    ),
    "@agent-native/core/resources": path.join(coreSrc, "resources/index.ts"),
    "@agent-native/core/oauth-tokens": path.join(
      coreSrc,
      "oauth-tokens/index.ts",
    ),
    "@agent-native/core/workspace-connections": path.join(
      coreSrc,
      "workspace-connections/index.ts",
    ),
    "@agent-native/core/a2a": path.join(coreSrc, "a2a/index.ts"),
    "@agent-native/core/router": path.join(coreSrc, "router/index.ts"),
    "@agent-native/core/terminal": path.join(
      coreSrc,
      "client/terminal/index.ts",
    ),
    "@agent-native/core/terminal/server": path.join(
      coreSrc,
      "terminal/index.ts",
    ),
    "@agent-native/core/adapters/cli": path.join(
      coreSrc,
      "adapters/cli/index.ts",
    ),
    "@agent-native/core/usage": path.join(coreSrc, "usage/store.ts"),
    // Shared stylesheet — alias to src so CSS edits (composer/theme rules)
    // take effect live in dev instead of silently loading the stale built
    // copy at dist/styles/. From src/styles/ the `@source "../client/**"`
    // directive resolves to the real .tsx source, which is what dev should
    // scan for Tailwind classes anyway.
    "@agent-native/core/styles/agent-native.css": path.join(
      coreSrc,
      "styles/agent-native.css",
    ),
  };

  // Escape special regex chars in the key and anchor with $
  return Object.entries(entries).map(([find, replacement]) => ({
    find: new RegExp(`^${find.replace(/[/]/g, "\\/")}$`),
    replacement,
  }));
}

export interface NitroOptions {
  /** Nitro deployment preset (e.g. "node", "vercel", "netlify", "cloudflare_pages"). Default: "node" */
  preset?: string;
  /** Source directory for server files. Default: "./server" */
  srcDir?: string;
  /** Routes directory name (relative to srcDir). Default: "routes" */
  routesDir?: string;
  /** Any additional Nitro config overrides */
  [key: string]: unknown;
}

export interface ClientConfigOptions {
  /** Port for dev server. Default: 8080 */
  port?: number;
  /** Additional hostnames allowed to access the dev server. */
  allowedHosts?: NonNullable<NonNullable<UserConfig["server"]>["allowedHosts"]>;
  /** Vite log level. Workspace child apps default to "warn" so only the gateway URL is advertised. */
  logLevel?: UserConfig["logLevel"];
  /** Additional Vite plugins */
  plugins?: any[];
  /** Nitro plugin options (preset, srcDir, etc) */
  nitro?: NitroOptions;
  /** Override resolve aliases */
  aliases?: Record<string, string>;
  /** Override build.outDir. Default: "dist/spa" */
  outDir?: string;
  /** Additional fs.allow paths */
  fsAllow?: string[];
  /** Additional fs.deny patterns */
  fsDeny?: string[];
  /** Additional Vite optimizeDeps configuration */
  optimizeDeps?: NonNullable<UserConfig["optimizeDeps"]>;
  /**
   * Whether to auto-inject the Tailwind v4 Vite plugin (`@tailwindcss/vite`).
   * Defaults to true — set to `false` if a template wants to manage Tailwind
   * itself (e.g. the legacy v3 PostCSS pipeline).
   */
  tailwind?: boolean;
  /**
   * Package names to stub in the SSR bundle with an empty proxy object.
   *
   * Use this for dependencies that only run in the browser (canvas / diagram
   * libraries, editors, WebGL) but would otherwise get pulled into the
   * server bundle via SSR's noExternal policy — pushing the CF Pages
   * Functions bundle over the 25 MiB limit.
   *
   * Only add packages that are provably never called during SSR. If the
   * server imports one, it will receive a Proxy that throws on any real
   * use (which is better than bundling a 10 MiB dep the worker never calls).
   *
   * @example
   * ssrStubs: ["mermaid", "@excalidraw/excalidraw"]
   */
  ssrStubs?: string[];
  /**
   * @deprecated Pass `reactRouter()` directly in the `plugins` array instead.
   * Previously used to auto-load the React Router Vite plugin via require(),
   * but this fails in ESM contexts. Templates should now do:
   * ```ts
   * import { reactRouter } from "@react-router/dev/vite";
   * defineConfig({ plugins: [reactRouter()] })
   * ```
   */
  reactRouter?: boolean | Record<string, unknown>;
}

/**
 * Vite plugin that recovers the page when Vite's dependency optimizer
 * invalidates modules mid-load (the "504 Outdated Optimize Dep" error).
 *
 * Without this, the page silently fails: <script type="module"> tags 504,
 * React never mounts, and the user is stuck on a blank screen until they
 * manually refresh. We catch the failure modes and auto-reload, with a
 * visible overlay so the user knows what's happening, and a loop guard
 * so we never thrash forever.
 *
 * CRITICAL: this must be a SYNCHRONOUS (non-module) script injected at
 * `head-prepend`. Module scripts are deferred — the browser starts fetching
 * all module scripts in parallel during HTML parsing, so a module listener
 * registers AFTER sibling modules have already started loading and
 * possibly errored out. A regular <script> blocks parsing and runs
 * synchronously, so the listener is registered before ANY module fetch
 * begins.
 *
 * Catches three failure modes (all before React needs to mount):
 *   1. <script type="module"> / <link> 504 — window "error" event, capture phase
 *   2. Dynamic import 504 — "unhandledrejection" with "dynamically imported module"
 *   3. Child module 504 — resource timing when browser exposes the HTTP status
 */
function autoReloadOnOptimizeDep(): Plugin {
  return {
    name: "agent-native-auto-reload-optimize-dep",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          // NOTE: no `type: "module"` — this must be a synchronous script.
          children: getViteDevRecoveryScript(),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

/**
 * Vite handles outdated optimized-dep requests inside its own transform
 * middleware and ends the HTTP response with `504 Outdated Optimize Dep`.
 * Browser module loaders do not consistently surface those child-module
 * failures to userland JavaScript, so also nudge the Vite HMR client from the
 * server side. This turns the confusing blank-screen state into the same
 * full-page reload Vite would have requested once optimization settled.
 */
function fullReloadOnOptimizeDep504(): Plugin {
  return {
    name: "agent-native-full-reload-optimize-dep-504",
    apply: "serve",
    configureServer(server) {
      let lastReloadAt = 0;
      server.middlewares.use((req, res, next) => {
        const originalEnd = res.end;
        (res as unknown as { end: (...args: unknown[]) => unknown }).end = (
          ...endArgs: unknown[]
        ) => {
          const statusMessage = String(res.statusMessage || "");
          if (
            res.statusCode === 504 &&
            statusMessage === "Outdated Optimize Dep"
          ) {
            const now = Date.now();
            if (now - lastReloadAt > 500) {
              lastReloadAt = now;
              server.ws.send({ type: "full-reload" });
              server.config.logger.info(
                `[agent-native] Vite optimized deps changed while loading ${
                  req.url ?? "a module"
                }; reloading the page.`,
                { timestamp: true },
              );
            }
          }
          return (originalEnd as (...args: unknown[]) => unknown).apply(
            res,
            endArgs,
          );
        };
        next();
      });
    },
  };
}

/**
 * Vite plugin that prevents the built-in base middleware from redirecting
 * "/" → "/app/" (or whatever the base is). When agent-native apps run with
 * --base /app/ in single-port mode, Vite's baseMiddleware sends a 302 from
 * "/" to the base path. This breaks Electron webview and iframe embeds
 * that load the app at the root. Instead, we rewrite "/" to the base path
 * internally so the app serves without a visible redirect.
 */
function baseRedirectGuard(): Plugin {
  return {
    name: "agent-native-base-redirect-guard",
    apply: "serve",
    configureServer(server) {
      // Return a function so the middleware is added AFTER Vite's internal
      // middleware is built — but we insert BEFORE by using the pre-hook
      // approach: configureServer hooks that return nothing run before
      // internal middleware.
      server.middlewares.use((req, res, next) => {
        const base = server.config.base;
        if (base && base !== "/" && req.url?.startsWith(base)) {
          const relativeUrl = req.url.slice(base.length - 1);
          try {
            const url = new URL(relativeUrl, "http://agent-native.local");
            const publicDir = server.config.publicDir;
            if (typeof publicDir !== "string") {
              return next();
            }
            const publicPath = path.normalize(
              path.join(publicDir, decodeURIComponent(url.pathname)),
            );
            if (
              publicPath.startsWith(publicDir + path.sep) &&
              fs.existsSync(publicPath) &&
              fs.statSync(publicPath).isFile()
            ) {
              const contentType = contentTypeForPublicFile(publicPath);
              if (contentType) res.setHeader("content-type", contentType);
              if (req.method === "HEAD") {
                res.statusCode = 200;
                res.end();
                return;
              }
              fs.createReadStream(publicPath).pipe(res);
              return;
            }
          } catch {
            // Fall through to Vite/Nitro. Malformed URLs should keep their
            // original path so the normal dev-server error handling applies.
          }
        }
        if (serveExternalEmbedBrowserManifest(server, req, res)) {
          return;
        }
        if (serveMountedEmbedRuntimeModule(server, req, res, base)) {
          return;
        }
        req.url = stripMountedDevApiPath(req.url, base);
        if (
          req.method === "HEAD" &&
          req.url &&
          !isFrameworkDevPath(req.url, base)
        ) {
          req.method = "GET";
        }
        if (
          base &&
          base !== "/" &&
          (req.url === "/" || req.url === "/index.html")
        ) {
          // Rewrite to the base path so Vite serves the app directly
          req.url = base;
        }
        next();
      });
    },
  };
}

const VITE_RUNTIME_PATH_PREFIXES = [
  "/@fs/",
  "/@id/",
  "/@vite/",
  "/app/",
  "/node_modules/",
  "/packages/",
  "/src/",
];

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function hasValidEmbedRuntimeToken(req: IncomingMessage): boolean {
  try {
    const url = new URL(req.url ?? "/", "http://agent-native.local");
    const queryToken = url.searchParams.get(EMBED_TOKEN_QUERY_PARAM);
    const cookieToken = cookieValue(req, EMBED_SESSION_COOKIE);
    return [queryToken, cookieToken].some(
      (token) => verifyEmbedSessionToken(token).ok,
    );
  } catch {
    return false;
  }
}

function mountedEmbedRuntimeModuleUrl(
  reqUrl: string | undefined,
  base: string | undefined,
): string | null {
  if (!reqUrl || !base || base === "/") return null;
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (!reqUrl.startsWith(normalizedBase)) return null;

  const runtimeUrl = reqUrl.slice(normalizedBase.length - 1) || "/";
  let url: URL;
  try {
    url = new URL(runtimeUrl, "http://agent-native.local");
  } catch {
    return null;
  }
  if (
    !VITE_RUNTIME_PATH_PREFIXES.some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  ) {
    return null;
  }
  url.searchParams.delete(EMBED_TOKEN_QUERY_PARAM);
  url.searchParams.delete(MCP_APP_CHAT_BRIDGE_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

function virtualModuleIdFromRuntimeUrl(runtimeUrl: string): string | null {
  try {
    const pathname = new URL(runtimeUrl, "http://agent-native.local").pathname;
    const prefix = "/@id/__x00__";
    if (!pathname.startsWith(prefix)) return null;
    return `\0${decodeURIComponent(pathname.slice(prefix.length))}`;
  } catch {
    return null;
  }
}

async function loadMountedEmbedRuntimeModule(
  server: any,
  runtimeUrl: string,
): Promise<string | null> {
  const virtualId = virtualModuleIdFromRuntimeUrl(runtimeUrl);
  if (virtualId) {
    const loaded = await server.pluginContainer?.load?.(virtualId);
    if (typeof loaded === "string") return loaded;
    if (loaded && typeof loaded.code === "string") return loaded.code;
  }
  const result = await server.transformRequest(runtimeUrl);
  return result?.code ?? null;
}

function serveMountedEmbedRuntimeModule(
  server: any,
  req: IncomingMessage,
  res: ServerResponse,
  base: string | undefined,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!hasValidEmbedRuntimeToken(req)) return false;
  const runtimeUrl = mountedEmbedRuntimeModuleUrl(req.url, base);
  if (!runtimeUrl) return false;

  void loadMountedEmbedRuntimeModule(server, runtimeUrl)
    .then((code: string | null) => {
      if (!code) {
        if (!res.headersSent) {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/javascript");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(code);
    })
    .catch((err: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(err instanceof Error ? err.message : String(err));
    });
  return true;
}

function publicOriginFromDevRequest(req: IncomingMessage): string | null {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    ?.trim();
  const host =
    forwardedHost ||
    String(req.headers.host ?? "")
      .split(",")[0]
      ?.trim();
  if (!host) return null;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const proto =
    forwardedProto ||
    (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

function isReactRouterBrowserManifestUrl(reqUrl: string | undefined): boolean {
  if (!reqUrl) return false;
  try {
    const url = new URL(reqUrl, "http://agent-native.local");
    return (
      virtualModuleIdFromRuntimeUrl(url.pathname) ===
      "\0virtual:react-router/browser-manifest"
    );
  } catch {
    return false;
  }
}

function rewriteRootRelativeManifestUrls(
  code: string,
  publicOrigin: string,
): string {
  return code.replace(/'\/(?!\/)([^']*)'/g, (match, rest: string) => {
    try {
      return JSON.stringify(new URL(`/${rest}`, publicOrigin).toString());
    } catch {
      return match;
    }
  });
}

function serveExternalEmbedBrowserManifest(
  server: any,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!isMcpEmbedCorsOrigin(String(req.headers.origin ?? ""))) return false;
  if (!isReactRouterBrowserManifestUrl(req.url)) return false;
  const publicOrigin = publicOriginFromDevRequest(req);
  if (!publicOrigin) return false;
  const runtimeUrl = mountedEmbedRuntimeModuleUrl(req.url, "/") ?? req.url;
  if (!runtimeUrl) return false;

  void loadMountedEmbedRuntimeModule(server, runtimeUrl)
    .then((code: string | null) => {
      if (!code) {
        if (!res.headersSent) {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/javascript");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(rewriteRootRelativeManifestUrls(code, publicOrigin));
    })
    .catch((err: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(err instanceof Error ? err.message : String(err));
    });
  return true;
}

function embedDevFrameHeaders(): Plugin {
  return {
    name: "agent-native-embed-dev-frame-headers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origin = String(req.headers.origin ?? "");
        if (isMcpEmbedCorsOrigin(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          );
          res.setHeader(
            "Access-Control-Allow-Headers",
            MCP_EMBED_CORS_ALLOW_HEADERS,
          );
          for (const [name, value] of Object.entries(
            MCP_EMBED_STATIC_ASSET_HEADERS,
          )) {
            if (name === "Access-Control-Allow-Origin") continue;
            res.setHeader(name, value);
          }
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
        }

        const cookieHeader = String(req.headers.cookie ?? "");
        let hasEmbedMarker = /\ban_embed_session=/.test(cookieHeader);
        try {
          const url = new URL(req.url ?? "/", "http://agent-native.local");
          hasEmbedMarker =
            hasEmbedMarker || url.searchParams.has("__an_embed_token");
        } catch {
          // Malformed URLs should continue through Vite's normal handling.
        }
        if (hasEmbedMarker) {
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          res.setHeader("Referrer-Policy", "no-referrer");
        }
        next();
      });
    },
  };
}

function contentTypeForPublicFile(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".ico":
      return "image/x-icon";
    case ".json":
    case ".webmanifest":
      return "application/json";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain";
    case ".xml":
      return "application/xml";
    default:
      return null;
  }
}

function devPathname(reqUrl: string): string {
  return new URL(reqUrl, "http://agent-native.local").pathname;
}

function isApiDevPath(reqUrl: string): boolean {
  const pathname = devPathname(reqUrl);
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function stripMountedDevApiPath(
  reqUrl: string | undefined,
  base: string | undefined,
): string | undefined {
  if (!reqUrl || !base || base === "/") return reqUrl;
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (!reqUrl.startsWith(normalizedBase)) return reqUrl;
  const stripped = reqUrl.slice(normalizedBase.length - 1) || "/";
  return isApiDevPath(stripped) ? stripped : reqUrl;
}

export function isFrameworkDevPath(
  reqUrl: string,
  base: string | undefined,
): boolean {
  const pathname = devPathname(reqUrl);
  if (pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")) {
    return true;
  }
  if (!base || base === "/") return false;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return (
    pathname === `${normalizedBase}/_agent-native` ||
    pathname.startsWith(`${normalizedBase}/_agent-native/`)
  );
}

/**
 * Work around a Rolldown bug where Nitro passes service entries as objects
 * ({index: "path"}) but Rolldown expects strings. This plugin normalizes
 * rollupOptions.input entries in the SSR environment.
 */
function rolldownInputFix(): Plugin {
  return {
    name: "agent-native-rolldown-input-fix",
    configEnvironment(name, config) {
      const input = config.build?.rollupOptions?.input;
      if (!Array.isArray(input)) return;
      // Flatten any object entries to just their string values
      const fixed = input.map((entry: any) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null) {
          const values = Object.values(entry);
          return values[0] as string;
        }
        return entry;
      });
      config.build!.rollupOptions!.input = fixed;
    },
  };
}

/**
 * Expose the resolved Vite dev server port as process.env.PORT so that
 * in-process scripts (which use localFetch → http://localhost:${PORT}/api/...)
 * hit the right address even when Vite auto-increments the port.
 */
/**
 * Replace caller-specified packages with an empty proxy stub during SSR
 * builds. For apps whose heavy browser-only deps would otherwise bloat the
 * edge worker past CF Pages' 25 MiB Functions limit.
 *
 * The template lists the packages in its `defineConfig({ ssrStubs })` call —
 * the framework never hardcodes package names.
 */
function ssrStubPlugin(packages: string[]): Plugin | null {
  if (!packages.length) return null;
  const stubbed = new Set(packages);
  const STUB_ID = "\0agent-native-ssr-stub";
  return {
    name: "agent-native-ssr-stub-heavy-libs",
    enforce: "pre",
    resolveId(id, _importer, opts) {
      if (!opts?.ssr) return null;
      // Match the bare package name or any subpath
      const pkg = id
        .split("/")
        .slice(0, id.startsWith("@") ? 2 : 1)
        .join("/");
      if (stubbed.has(pkg)) return STUB_ID;
      return null;
    },
    load(id) {
      if (id !== STUB_ID) return null;
      // Proxy that answers any property access with itself — lets dead
      // import/re-export chains parse without blowing up, and still throws
      // if code actually tries to call any of it on the server.
      return (
        "const handler = { get(_, p) { " +
        "if (p === Symbol.toPrimitive) return () => ''; " +
        "if (p === 'then') return undefined; " +
        "return new Proxy(() => {}, handler); " +
        "} };" +
        "const stub = new Proxy(() => {}, handler);" +
        "export default stub;"
      );
    },
  };
}

function portExposer(): Plugin {
  return {
    name: "agent-native-port-exposer",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object" && addr.port) {
          process.env.PORT = String(addr.port); // guard:allow-env-mutation — Vite dev server port published once at boot before any request
        }
      });
    },
  };
}

/**
 * Silence benign connection-reset noise from Vite's dev middleware.
 * Fires when a browser closes/reloads/navigates mid-request — the peer has
 * already gone away, there's nothing to fix, and Vite's error middleware
 * spams the terminal and browser HMR overlay with errors like
 * "read ECONNRESET" and "socket hang up". Our H3 server layer already
 * swallows these (create-server.ts onError); this plugin does the same for
 * Vite's own connect pipeline.
 */
function silenceConnectionResets(): Plugin {
  const isBenign = (err: unknown) => {
    const e = err as
      | (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })
      | undefined;
    const code = e?.code || (e?.cause as NodeJS.ErrnoException)?.code;
    const message = String(e?.message ?? "");
    return (
      code === "ECONNRESET" ||
      code === "ECONNABORTED" ||
      code === "EPIPE" ||
      /^(read ECONNRESET|write ECONNRESET|socket hang up|aborted|write EPIPE)$/i.test(
        message,
      )
    );
  };
  const isBenignErrorPayload = (payload: unknown) => {
    const p = payload as { type?: string; err?: unknown } | undefined;
    return p?.type === "error" && isBenign(p.err);
  };
  return {
    name: "agent-native-silence-connection-resets",
    apply: "serve",
    configureServer(server) {
      // Swallow socket-level resets so Node doesn't surface them as uncaught.
      server.httpServer?.on("connection", (socket) => {
        socket.on("error", (err) => {
          if (!isBenign(err)) throw err;
        });
      });
      // Drop Vite's "Internal server error: read ECONNRESET" log lines.
      const origError = server.config.logger.error.bind(server.config.logger);
      server.config.logger.error = (msg, opts) => {
        const text = typeof msg === "string" ? msg : String(msg ?? "");
        if (
          (opts?.error && isBenign(opts.error)) ||
          /Internal server error:\s*(read ECONNRESET|write ECONNRESET|socket hang up|aborted|EPIPE)/i.test(
            text,
          )
        ) {
          return;
        }
        origError(msg, opts);
      };

      // Vite's error middleware sends these same benign errors to the HMR
      // client, which turns them into the full-screen browser overlay.
      // Suppress just those payloads while leaving real transform/runtime
      // errors untouched.
      const hot = (
        server as unknown as {
          environments?: { client?: { hot?: { send?: Function } } };
        }
      ).environments?.client?.hot;
      if (hot?.send) {
        const origHotSend = hot.send.bind(hot);
        hot.send = (payload: unknown, ...args: unknown[]) => {
          if (isBenignErrorPayload(payload)) return;
          return origHotSend(payload, ...args);
        };
      }

      const ws = (server as unknown as { ws?: { send?: Function } }).ws;
      if (ws?.send) {
        const origWsSend = ws.send.bind(ws);
        ws.send = (payload: unknown, ...args: unknown[]) => {
          if (isBenignErrorPayload(payload)) return;
          return origWsSend(payload, ...args);
        };
      }
    },
  };
}

/**
 * Create the client Vite config with sensible agent-native defaults.
 * Supports two modes:
 * - Legacy SPA mode (default): React SWC plugin, client-only routing
 * - React Router framework mode: SSR-capable with file-based routing
 *
 * Both modes include Nitro for API routes, path aliases, and fs restrictions.
 */
export function defineConfig(options: ClientConfigOptions = {}): UserConfig {
  // Check if React Router plugin was passed directly in plugins array
  const hasReactRouterPlugin = options.plugins?.some(
    (p: any) =>
      p?.name === "react-router" ||
      (Array.isArray(p) && p.some((pp: any) => pp?.name === "react-router")),
  );

  let reactTransformPlugin: any;

  if (!hasReactRouterPlugin && !options.reactRouter) {
    // Legacy SPA mode — use React SWC plugin (only when React Router is not used)
    try {
      reactTransformPlugin = require("@vitejs/plugin-react-swc");
      if (reactTransformPlugin.default)
        reactTransformPlugin = reactTransformPlugin.default;
    } catch {
      // Will be resolved at runtime by Vite
    }
  }

  const cwd = process.cwd();

  // Workspace env fallback. If this app is inside a workspace, tell Vite to
  // also look for .env files at the workspace root. Per-app .env still wins
  // (Vite's loadEnv merges in precedence order — app dir is loaded after).
  const workspaceRoot = findWorkspaceRoot(cwd);
  const envDir = workspaceRoot && workspaceRoot !== cwd ? workspaceRoot : cwd;

  // Preload workspace-root .env into process.env so Nitro server code sees
  // shared keys during dev (Nitro reads process.env, not vite's envDir).
  if (workspaceRoot && workspaceRoot !== cwd) {
    try {
      const dotenv = require("dotenv");
      dotenv.config({
        path: path.join(workspaceRoot, ".env"),
        override: false,
        // Suppress the dotenv v17 tip line — this loader fires alongside
        // utils.ts loadEnv() during dev startup and would otherwise emit a
        // duplicate "[dotenv] injecting env" message.
        quiet: true,
      });
    } catch {}
  }

  // Build the React transform plugin (only for legacy SPA mode)
  const reactPluginInstance = reactTransformPlugin?.();

  // Auto-inject the Tailwind v4 Vite plugin if `@tailwindcss/vite` is
  // installed (which it is by default for all agent-native templates).
  // Templates can opt out by setting `options.tailwind = false`.
  let tailwindPluginInstance: any = null;
  if (options.tailwind !== false) {
    try {
      let tailwindPlugin = require("@tailwindcss/vite");
      if (tailwindPlugin.default) tailwindPlugin = tailwindPlugin.default;
      // Tailwind's Vite optimizer uses Lightning CSS internally and runs
      // before Vite's own CSS minifier. Lightning CSS collapses the standard
      // `backdrop-filter` declaration when a `-webkit-` fallback is present,
      // so let Vite/esbuild handle the production CSS pass instead.
      tailwindPluginInstance = tailwindPlugin({ optimize: false });
    } catch {
      // Plugin not installed — silently skip. Old templates may still be on v3.
    }
  }

  // APP_BASE_PATH lets this app be mounted under a prefix (e.g. "/mail") as
  // part of a unified workspace deploy. Defaults to "/" for standalone apps.
  const appBasePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "/";
  const isWorkspaceChild = process.env.AGENT_NATIVE_WORKSPACE === "1";
  const base = appBasePath.endsWith("/") ? appBasePath : `${appBasePath}/`;
  const monorepoCoreAllow = [
    path.resolve(cwd, "../../packages/core"),
    path.resolve(cwd, "../core"),
  ].filter((candidate) => fs.existsSync(path.join(candidate, "package.json")));

  // Workspace-core (enterprise monorepo): pull its directory into Vite's
  // file watcher + module graph so edits to its TS sources hot-reload the
  // dev server, and its package name into ssr.noExternal so the dynamic
  // import in framework-request-handler.ts goes through Vite's transform
  // pipeline (TypeScript, SSR HMR, the works).
  const workspaceCore = findWorkspaceCoreSync(cwd);
  const workspaceCoreFsAllow = workspaceCore ? [workspaceCore.packageDir] : [];
  const workspaceCoreNoExternal = workspaceCore
    ? [new RegExp(`^${escapeRegex(workspaceCore.packageName)}(/.*)?$`)]
    : [];

  return {
    logLevel: options.logLevel ?? (isWorkspaceChild ? "warn" : undefined),
    envDir,
    base,
    server: {
      host: "::",
      port: options.port ?? 8080,
      allowedHosts: options.allowedHosts ?? [
        ".ngrok-free.dev",
        ".ngrok-free.app",
        ".ngrok.io",
        ".trycloudflare.com",
      ],
      fs: {
        allow: [
          ".",
          ...monorepoCoreAllow,
          ...workspaceCoreFsAllow,
          ...(options.fsAllow ?? []),
        ],
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          ...(options.fsDeny ?? []),
        ],
      },
    },
    build: {
      outDir: options.outDir ?? "dist/spa",
      // Vite 8 defaults CSS minification to Lightning CSS, which collapses a
      // `backdrop-filter` + `-webkit-backdrop-filter` pair down to only the
      // prefixed form. Chrome ignores that, so glass effects disappear in
      // production. Keep esbuild as the CSS minifier and target Safari 18+ so
      // the standard property survives the production pipeline.
      cssMinify: "esbuild",
      cssTarget: ["es2020", "safari18"],
    },
    // Bundle all non-Node.js deps into the production SSR server build.
    // Edge runtimes (CF Workers, Deno) don't have node_modules at runtime.
    // In dev, React Router's Vite Environment runner expects CJS packages
    // like React to stay external; forcing them through the module runner
    // raises `module is not defined`.
    ssr: process.argv.includes("build")
      ? {
          noExternal: /^(?!node:)/,
          // Pick the workspace-core's compiled `dist/` exports in prod —
          // Node-style `default` condition matches what edge runtimes (CF
          // Workers, Deno) can actually load. Without this, Vite's prod
          // build inherits the dev-condition src/ entry and ships unbuilt
          // TypeScript into the worker.
          resolve: {
            conditions: ["node", "module", "import", "default"],
            externalConditions: ["node", "module", "import", "default"],
          },
        }
      : {
          // Vite already sets `development` in the dev resolve conditions,
          // so the workspace-core template's exports.development → src/
          // entry is picked automatically — Vite handles TS compilation
          // and triggers a server restart when those files change.
          noExternal: [
            /^@agent-native\/core(\/.*)?$/,
            // Radix UI primitives are transitive deps of @agent-native/core
            // (used by FeedbackButton, AgentSidebar, ShareDialog, etc.). When
            // a consumer app SSRs a component that imports Radix, Node's
            // externalized resolver can't find @radix-ui/* from the app cwd
            // because pnpm doesn't hoist transitive deps. Bundling them
            // through Vite resolves them via the workspace store.
            /^@radix-ui\//,
            // scheduling ships tsc-compiled dist files that contain literal
            // `@/` path-alias imports (e.g. `import { Input } from
            // "@/components/ui/input"`). In standalone (published) mode Node
            // treats the package as an external CJS dep and can't resolve
            // `@/components`. Adding it to noExternal makes Vite process it
            // through the module pipeline, where the consumer app's `@` →
            // `./app` alias is already registered.
            ...(hasDep("@agent-native/scheduling", cwd)
              ? [/^@agent-native\/scheduling(\/.*)?$/]
              : []),
            ...workspaceCoreNoExternal,
          ],
          external: [
            "react",
            "react-dom",
            "react-dom/server",
            "react-router",
            "react-router/dom",
            "react-router-dom",
          ],
        },
    plugins: [
      // Stub packages from `options.ssrStubs` in the SSR bundle so they
      // don't bloat the edge worker. Opt-in per template — the framework
      // hardcodes nothing (e.g. docs sites legitimately import `shiki` on
      // the server, so we can't blanket-stub it here).
      ...(() => {
        const p = ssrStubPlugin(options.ssrStubs ?? []);
        return p ? [p] : [];
      })(),
      ...(options.plugins ?? []),
      actionTypesPlugin(),
      agentsBundlePlugin(),
      autoReloadOnOptimizeDep(),
      fullReloadOnOptimizeDep504(),
      embedDevFrameHeaders(),
      baseRedirectGuard(),
      portExposer(),
      silenceConnectionResets(),
      rolldownInputFix(),
      // Nitro Vite plugin for dev-mode API route serving and HMR.
      // Disabled during build — React Router's build handles production.
      ...(process.argv.includes("build")
        ? []
        : [
            nitroVitePlugin({
              serverDir: "./server",
              ...(options.nitro ?? {}),
              routeRules: {
                ...mcpEmbedStaticAssetRouteRules(appBasePath),
                ...((options.nitro as { routeRules?: Record<string, any> })
                  ?.routeRules ?? {}),
              },
            } as any),
          ]),
      reactPluginInstance,
      tailwindPluginInstance,
    ].filter(Boolean),
    optimizeDeps: {
      include: [
        ...getDefaultOptimizeDeps(cwd),
        ...(hasDep("@agent-native/pinpoint", cwd)
          ? ["@agent-native/pinpoint/react"]
          : []),
        ...(options.optimizeDeps?.include ?? []),
      ],
      // In monorepo mode: explicitly exclude @agent-native/core subpaths so
      // Vite never prebundles them from dist/. The source alias above
      // (`getCoreSourceAliases`) resolves every import to src/ on every
      // request, so HMR picks up new exports immediately. Without exclude,
      // the prebundle is built from dist/ once at startup and silently
      // serves stale code even after the source / dist is updated.
      exclude: [
        ...(findCoreSrcDir(cwd) !== null ? CORE_CLIENT_SUBPATHS : []),
        ...(options.optimizeDeps?.exclude ?? []),
      ],
    },
    resolve: {
      // Dedupe all client-side packages that core shares with the consuming
      // app. In pnpm monorepos, core's devDependencies can install separate
      // copies (linked to different React versions). Without deduping, each
      // copy creates its own React context — QueryClientProvider, RouterProvider,
      // Radix, etc. — causing "No provider" crashes at runtime.
      dedupe: getClientDedupe(cwd),
      alias: [
        // In monorepo dev: resolve @agent-native/core to source for HMR.
        // Uses regex with $ anchor for exact matching to prevent
        // @agent-native/core from prefix-matching @agent-native/core/client.
        ...getCoreSourceAliases(cwd),
        // Standard path aliases (prefix matching is fine here)
        { find: "@", replacement: path.resolve(cwd, "./app") },
        { find: "@shared", replacement: path.resolve(cwd, "./shared") },
        ...Object.entries(options.aliases ?? {}).map(([find, replacement]) => ({
          find,
          replacement,
        })),
      ],
    },
  };
}
