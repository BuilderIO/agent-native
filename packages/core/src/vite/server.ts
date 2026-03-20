import path from "path";
import type { UserConfig } from "vite";

export interface ServerConfigOptions {
  /** Server entry file. Default: "server/node-build.ts" */
  entry?: string;
  /** Output directory. Default: "dist/server" */
  outDir?: string;
  /** Output filename (without extension). Default: "production" */
  fileName?: string;
  /** Node target. Default: "node22" */
  target?: string;
  /** Additional external packages to exclude from bundle */
  external?: string[];
  /** Override resolve aliases */
  aliases?: Record<string, string>;
}

const NODE_BUILTINS = [
  "fs",
  "path",
  "url",
  "http",
  "https",
  "os",
  "crypto",
  "stream",
  "util",
  "events",
  "buffer",
  "querystring",
  "child_process",
  "net",
  "tls",
  "dns",
  "zlib",
  "assert",
  "worker_threads",
];

/**
 * Create the server build Vite config.
 * Builds the Node.js server entry as an ES module with externalized dependencies.
 */
export function defineServerConfig(
  options: ServerConfigOptions = {},
): UserConfig {
  const cwd = process.cwd();
  const entry = options.entry ?? "server/node-build.ts";

  return {
    build: {
      lib: {
        entry: path.resolve(cwd, entry),
        name: "server",
        fileName: options.fileName ?? "production",
        formats: ["es"],
      },
      outDir: options.outDir ?? "dist/server",
      target: options.target ?? "node22",
      ssr: true,
      rollupOptions: {
        external: [
          ...NODE_BUILTINS,
          "h3",
          "express",
          "cors",
          ...(options.external ?? []),
        ],
        output: {
          format: "es",
          entryFileNames: "[name].mjs",
        },
      },
      minify: false,
      sourcemap: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(cwd, "./client"),
        "@shared": path.resolve(cwd, "./shared"),
        ...options.aliases,
      },
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  };
}
