import path from "path";
import type { UserConfig } from "vite";
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
      fs: {
        allow: ["./client", "./shared", ...(options.fsAllow ?? [])],
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
