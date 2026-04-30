import path from "path";
import fs from "fs";
import { createRequire } from "module";
import type { Plugin, UserConfig } from "vite";
import { nitro as nitroVitePlugin } from "nitro/vite";
import { actionTypesPlugin } from "./action-types-plugin.js";
import { agentsBundlePlugin } from "./agents-bundle-plugin.js";
import { findWorkspaceRoot } from "../scripts/utils.js";

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
  // Detect monorepo: walk up to find packages/core/src/
  const candidates = [
    path.resolve(cwd, "../../packages/core"), // templates/<name>/
    path.resolve(cwd, "../core"), // packages/<name>/
  ];

  let coreSrc = "";
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src/index.ts"))) {
      coreSrc = path.join(candidate, "src");
      break;
    }
  }

  if (!coreSrc) return []; // Not in monorepo — use dist as normal

  // Map every @agent-native/core/* export to its src/ equivalent.
  // Each entry uses a regex with $ anchor for exact matching.
  const entries: Record<string, string> = {
    "@agent-native/core": path.join(coreSrc, "index.browser.ts"),
    "@agent-native/core/server": path.join(coreSrc, "server/index.ts"),
    "@agent-native/core/client": path.join(coreSrc, "client/index.ts"),
    "@agent-native/core/client/tools": path.join(
      coreSrc,
      "client/tools/index.ts",
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
  optimizeDeps?: { include?: string[]; exclude?: string[] };
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
 * Catches two failure modes (both window-level, no HMR needed):
 *   1. <script type="module"> / <link> 504 — window "error" event, capture phase
 *   2. Dynamic import 504 — "unhandledrejection" with "dynamically imported module"
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
          children: `
(function() {
  var RELOAD_KEY = "__an_optimize_reload";
  var MAX_RELOADS = 3;
  var RESET_AFTER_MS = 8000;

  var reloadTimer = null;
  var overlayShown = false;

  // Track recent reloads in sessionStorage. If we reload too many times
  // in a short window, stop and show a manual-refresh message instead of
  // looping forever.
  function readReloadHistory() {
    try {
      var raw = sessionStorage.getItem(RELOAD_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      var cutoff = Date.now() - 30000;
      return Array.isArray(arr) ? arr.filter(function(t) { return t > cutoff; }) : [];
    } catch (e) { return []; }
  }
  function recordReload() {
    try {
      var history = readReloadHistory();
      history.push(Date.now());
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify(history));
    } catch (e) {}
  }
  // Reset the counter after a stable period (page didn't fail again).
  setTimeout(function() {
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) {}
  }, RESET_AFTER_MS);

  function showOverlay(title, subtitle) {
    if (overlayShown) return;
    overlayShown = true;
    var mount = function() {
      if (!document.body) { setTimeout(mount, 16); return; }
      var el = document.createElement("div");
      el.id = "__an-reload-overlay";
      el.style.cssText = [
        "position:fixed","inset:0","z-index:2147483647",
        "display:flex","align-items:center","justify-content:center",
        "background:rgba(0,0,0,0.6)","backdrop-filter:blur(8px)",
        "-webkit-backdrop-filter:blur(8px)",
        "font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
        "color:#fff","font-size:14px"
      ].join(";");
      el.innerHTML =
        '<div style="background:#171717;padding:20px 24px;border-radius:12px;' +
        'border:1px solid rgba(255,255,255,0.1);max-width:340px;text-align:center;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.5)">' +
        '<div style="font-weight:600;margin-bottom:6px">' + title + '</div>' +
        '<div style="font-size:12px;opacity:0.7">' + subtitle + '</div>' +
        '</div>';
      document.body.appendChild(el);
    };
    mount();
  }

  function scheduleReload(reason) {
    if (reloadTimer) return;
    var history = readReloadHistory();
    if (history.length >= MAX_RELOADS) {
      console.warn("[agent-native] Dev server keeps re-bundling. Manual refresh needed.", reason);
      showOverlay(
        "Dev server out of sync",
        "Auto-reload gave up after " + MAX_RELOADS + " tries. Refresh the page (\u2318R / Ctrl+R)."
      );
      return;
    }
    console.log("[agent-native] Vite re-bundled deps (" + reason + "), reloading\u2026");
    recordReload();
    // First reload is silent — one refresh almost always fixes it and the
    // overlay flash is more disruptive than the reload itself. Only show
    // the overlay starting on the second attempt, when something is clearly
    // taking longer than expected.
    if (history.length >= 1) {
      showOverlay("Updating dev server\u2026", "Reloading the page");
    }
    reloadTimer = setTimeout(function() { window.location.reload(); }, 300);
  }

  function looksLikeViteDep(url) {
    if (!url) return false;
    // Only treat same-origin URLs as Vite deps — don't reload the page
    // because some third-party CDN script 404'd.
    try {
      var u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return false;
    } catch (e) { return false; }
    return url.indexOf("/node_modules/.vite/deps/") !== -1
        || url.indexOf("/@fs/") !== -1
        || url.indexOf("/@id/") !== -1
        || url.indexOf("?v=") !== -1
        || url.indexOf("?import") !== -1
        || /\\.(m?js|ts|tsx|jsx)(\\?|$)/.test(url);
  }

  // 1) <script type="module"> / <link> 504 — fires on the element, not window,
  //    so we use capture phase to catch resource load errors.
  window.addEventListener("error", function(e) {
    var t = e.target;
    if (!t || t === window) return;
    var tag = t.tagName;
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    var url = t.src || t.href || "";
    if (looksLikeViteDep(url)) {
      var name = url.split("/").pop();
      scheduleReload("script 504: " + name);
    }
  }, true);

  // 2) Dynamic import failures (React Router code splitting, lazy components)
  window.addEventListener("unhandledrejection", function(e) {
    var msg = String((e.reason && (e.reason.message || e.reason)) || "");
    if (
      msg.indexOf("Failed to fetch dynamically imported module") !== -1 ||
      msg.indexOf("error loading dynamically imported module") !== -1 ||
      msg.indexOf("Importing a module script failed") !== -1 ||
      msg.indexOf("Outdated Optimize Dep") !== -1 ||
      (msg.indexOf("504") !== -1 && msg.indexOf(".vite/deps") !== -1)
    ) {
      scheduleReload("dynamic import");
    }
  });
})();`,
          injectTo: "head-prepend",
        },
      ];
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
      server.middlewares.use((req, _res, next) => {
        const base = server.config.base;
        if (
          base &&
          base !== "/" &&
          req.url?.startsWith(base) &&
          req.url.slice(base.length - 1).startsWith("/api/")
        ) {
          req.url = req.url.slice(base.length - 1);
        }
        if (
          req.method === "HEAD" &&
          req.url &&
          !req.url.startsWith("/_agent-native/") &&
          !(base && base !== "/" && req.url.startsWith(`${base}_agent-native/`))
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
 * Silence benign `read ECONNRESET` noise from Vite's dev middleware.
 * Fires when a browser closes/reloads/navigates mid-request — the peer has
 * already gone away, there's nothing to fix, and Vite's error middleware
 * spams the terminal with "Internal server error: read ECONNRESET". Our H3
 * server layer already swallows this (create-server.ts onError); this plugin
 * does the same for Vite's own connect pipeline.
 */
function silenceConnectionResets(): Plugin {
  const isBenign = (err: unknown) => {
    const e = err as NodeJS.ErrnoException | undefined;
    const code = e?.code || (e?.cause as NodeJS.ErrnoException)?.code;
    return (
      code === "ECONNRESET" ||
      code === "ECONNABORTED" ||
      code === "EPIPE" ||
      e?.message === "aborted"
    );
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
          /Internal server error:\s*(read ECONNRESET|aborted|EPIPE)/i.test(text)
        ) {
          return;
        }
        origError(msg, opts);
      };
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
      tailwindPluginInstance = tailwindPlugin();
    } catch {
      // Plugin not installed — silently skip. Old templates may still be on v3.
    }
  }

  // APP_BASE_PATH lets this app be mounted under a prefix (e.g. "/mail") as
  // part of a unified workspace deploy. Defaults to "/" for standalone apps.
  const appBasePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "/";
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
    envDir,
    base,
    server: {
      host: "::",
      port: options.port ?? 8080,
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
      // Safari 18+ so esbuild's CSS minifier keeps the standard
      // backdrop-filter. Targeting older Safari caused it to drop the
      // unprefixed version (Safari only got unprefixed backdrop-filter in
      // 18.0, Sept 2024) and keep just -webkit-backdrop-filter, which broke
      // the blur in prod where the unprefixed form was expected.
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
            } as any),
          ]),
      reactPluginInstance,
      tailwindPluginInstance,
    ].filter(Boolean),
    optimizeDeps: {
      include: [
        "@tabler/icons-react",
        ...(hasDep("@agent-native/pinpoint", cwd)
          ? ["@agent-native/pinpoint/react"]
          : []),
        ...(options.optimizeDeps?.include ?? []),
      ],
      ...(options.optimizeDeps?.exclude
        ? { exclude: options.optimizeDeps.exclude }
        : {}),
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
