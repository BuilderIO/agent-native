import path from "path";
import type { Plugin, UserConfig } from "vite";
import { expressPlugin, type ExpressPluginOptions } from "./express-plugin.js";

export interface ClientConfigOptions {
  /** Port for dev server. Default: 8080 */
  port?: number;
  /** Additional Vite plugins */
  plugins?: any[];
  /** Express plugin options (serverEntry, etc) */
  express?: ExpressPluginOptions;
  /** Override resolve aliases */
  aliases?: Record<string, string>;
  /** Override build.outDir. Default: "dist/spa" */
  outDir?: string;
  /** Additional fs.allow paths */
  fsAllow?: string[];
  /** Additional fs.deny patterns */
  fsDeny?: string[];
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
 * Create the client/SPA Vite config with sensible agent-native defaults.
 * Includes React SWC, path aliases, fs restrictions, and the Express dev plugin.
 */
export function defineConfig(options: ClientConfigOptions = {}): UserConfig {
  // Dynamic import to keep it optional
  let reactPlugin: any;
  try {
    reactPlugin = require("@vitejs/plugin-react-swc");
    if (reactPlugin.default) reactPlugin = reactPlugin.default;
  } catch {
    // Will be resolved at runtime by Vite
  }

  const cwd = process.cwd();

  return {
    server: {
      host: "::",
      port: options.port ?? 8080,
      watch: {
        // Ignore .env changes — env vars are applied via process.env directly
        // without needing a server restart, so this avoids disruptive reloads
        ignored: ["**/.env"],
      },
      fs: {
        allow: [".", ...(options.fsAllow ?? [])],
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "server/**",
          ...(options.fsDeny ?? []),
        ],
      },
    },
    build: {
      outDir: options.outDir ?? "dist/spa",
    },
    plugins: [
      baseRedirectGuard(),
      reactPlugin?.(),
      expressPlugin(options.express),
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
