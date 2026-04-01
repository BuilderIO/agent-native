import path from "path";
import fs from "fs";
import { createRequire } from "module";
import type { Plugin, UserConfig } from "vite";
import { devApiServer } from "./dev-api-server.js";

const require = createRequire(import.meta.url);

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

  // Nitro 3.0's Vite plugin (nitro/vite) uses a FetchableDevEnvironment
  // that is incompatible with Vite 7/8's DevEnvironment API. Loading it
  // crashes typecheck, build, and any Vite server creation. Nitro's
  // file-based routes are handled by its runtime (via the server/routes/
  // directory) independently of this plugin, so we skip it entirely.
  // The Nitro plugin can be re-enabled once Nitro ships a Vite 7+ compatible
  // release.
  const nitroPlugin: any = null;

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
      devApiServer(),
      reactPluginInstance,
      nitroPlugin?.(),
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
      alias: {
        "@": path.resolve(cwd, "./app"),
        "@shared": path.resolve(cwd, "./shared"),
        ...options.aliases,
      },
    },
  };
}
