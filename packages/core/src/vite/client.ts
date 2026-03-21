import path from "path";
import type { Plugin, UserConfig } from "vite";

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
   * Use React Router framework mode instead of plain React SWC plugin.
   * When true, uses `reactRouter()` from `@react-router/dev/vite` which
   * includes React transformation internally — no need for `@vitejs/plugin-react-swc`.
   * Default: false (uses @vitejs/plugin-react-swc for backward compatibility)
   */
  reactRouter?: boolean | Record<string, unknown>;
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
  const useReactRouter = !!options.reactRouter;

  let reactTransformPlugin: any;

  if (useReactRouter) {
    // React Router framework mode — includes React transformation internally
    try {
      const rrDev = require("@react-router/dev/vite");
      reactTransformPlugin =
        rrDev.reactRouter ?? rrDev.default ?? rrDev;
    } catch {
      // Will be resolved at runtime by Vite
    }
  } else {
    // Legacy SPA mode — use React SWC plugin
    try {
      reactTransformPlugin = require("@vitejs/plugin-react-swc");
      if (reactTransformPlugin.default)
        reactTransformPlugin = reactTransformPlugin.default;
    } catch {
      // Will be resolved at runtime by Vite
    }
  }

  // Dynamic import for nitro/vite — it's a dependency of @agent-native/core
  let nitroPlugin: any;
  try {
    nitroPlugin = require("nitro/vite");
    if (nitroPlugin.default) nitroPlugin = nitroPlugin.default;
    if (nitroPlugin.nitro) nitroPlugin = nitroPlugin.nitro;
  } catch {
    // Will be resolved at runtime by Vite
  }

  const cwd = process.cwd();

  // Build nitro options from user config
  const { preset, srcDir, routesDir, ...restNitro } = options.nitro ?? {};
  const nitroOpts: Record<string, unknown> = {
    ...restNitro,
  };
  if (preset) nitroOpts.preset = preset;
  if (srcDir) nitroOpts.srcDir = srcDir;
  if (routesDir) nitroOpts.routesDir = routesDir;

  // Build the React transform plugin with appropriate options
  const reactRouterOpts =
    typeof options.reactRouter === "object" ? options.reactRouter : {};
  const reactPluginInstance = useReactRouter
    ? reactTransformPlugin?.(reactRouterOpts)
    : reactTransformPlugin?.();

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
      baseRedirectGuard(),
      reactPluginInstance,
      nitroPlugin?.(nitroOpts),
      ...(options.plugins ?? []),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(cwd, "./client"),
        "@shared": path.resolve(cwd, "./shared"),
        ...options.aliases,
      },
    },
  };
}
