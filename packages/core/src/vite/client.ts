import path from "path";
import fs from "fs";
import { createRequire } from "module";
import type { Plugin, UserConfig } from "vite";
import { nitro as nitroVitePlugin } from "nitro/vite";

import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    "@agent-native/core/adapters/sync": path.join(
      coreSrc,
      "adapters/sync/index.ts",
    ),
    "@agent-native/core/adapters/drizzle": path.join(
      coreSrc,
      "adapters/drizzle/index.ts",
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
 * Vite plugin that auto-reloads the page when Vite's dependency optimizer
 * invalidates modules (the "504 outdated optimize dep" error). Instead of
 * leaving the app in a broken state requiring a manual refresh, this
 * injects a tiny client script that listens for these errors and reloads
 * automatically after a brief delay to let the optimizer finish.
 */
function autoReloadOnOptimizeDep(): Plugin {
  return {
    name: "agent-native-auto-reload-optimize-dep",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: `
if (import.meta.hot) {
  let reloadTimer;
  // Vite sends "error" payloads when module fetches fail (504 outdated dep)
  import.meta.hot.on("vite:error", (payload) => {
    const msg = payload?.err?.message || "";
    if (msg.includes("504") || msg.includes("outdated")) {
      if (!reloadTimer) {
        console.log("[agent-native] Dependency optimizer updated, reloading...");
        reloadTimer = setTimeout(() => window.location.reload(), 800);
      }
    }
  });
  // Vite also fires beforeUpdate before a full reload from optimizer changes.
  // If we get a vite:beforeFullReload after an error, clear our timer so
  // Vite handles it natively.
  import.meta.hot.on("vite:beforeFullReload", () => {
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
  });
}`,
          injectTo: "head",
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
function portExposer(): Plugin {
  return {
    name: "agent-native-port-exposer",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object" && addr.port) {
          process.env.PORT = String(addr.port);
        }
      });
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

  // Build the React transform plugin (only for legacy SPA mode)
  const reactPluginInstance = reactTransformPlugin?.();

  return {
    server: {
      host: "::",
      port: options.port ?? 8080,
      fs: {
        allow: [".", ...(options.fsAllow ?? [])],
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
    },
    plugins: [
      autoReloadOnOptimizeDep(),
      baseRedirectGuard(),
      portExposer(),
      rolldownInputFix(),
      // Nitro Vite plugin for dev-mode API route serving and HMR.
      // Disabled during build — React Router's build handles production
      // bundling, and deploy/build.ts handles deployment presets.
      ...(process.argv.includes("build")
        ? []
        : [
            nitroVitePlugin({
              serverDir: "./server",
              ...(options.nitro ?? {}),
            } as any),
          ]),
      reactPluginInstance,
      ...(options.plugins ?? []),
    ].filter(Boolean),
    optimizeDeps: {
      include: [
        "@tabler/icons-react",
        ...(hasDep("@agent-native/pinpoint", cwd)
          ? ["@agent-native/pinpoint/react"]
          : []),
      ],
    },
    resolve: {
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
