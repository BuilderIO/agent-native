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
 *
 * Usage: node deploy/build.js (called automatically by `agent-native build`)
 */

import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import {
  discoverApiRoutes,
  discoverPlugins,
  type DiscoveredRoute,
} from "./route-discovery.js";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";

/** Plugins that require Node.js runtime and cannot run on edge/serverless */
const NODE_ONLY_PLUGINS = new Set([
  "terminal", // PTY requires child_process
  "file-sync", // chokidar requires fs watchers
  "agent-chat", // spawns child processes for scripts
]);

function isNodeOnlyPlugin(filePath: string): boolean {
  const basename = path.basename(filePath, path.extname(filePath));
  return NODE_ONLY_PLUGINS.has(basename);
}

/**
 * Generate the worker entry source code that wires up H3 + React Router SSR.
 */
function generateWorkerEntry(
  routes: DiscoveredRoute[],
  pluginPaths: string[],
): string {
  const routeImports: string[] = [];
  const routeRegistrations: string[] = [];

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const varName = `route_${i}`;
    // Use the absolute path for the import
    routeImports.push(`import ${varName} from ${JSON.stringify(r.absPath)};`);
    routeRegistrations.push(
      `  router.${r.method}(${JSON.stringify(r.route)}, ${varName});`,
    );
  }

  // Filter out Node-only plugins
  const edgePlugins = pluginPaths.filter((p) => !isNodeOnlyPlugin(p));
  const pluginImports: string[] = [];
  const pluginCalls: string[] = [];

  for (let i = 0; i < edgePlugins.length; i++) {
    const varName = `plugin_${i}`;
    pluginImports.push(
      `import ${varName} from ${JSON.stringify(edgePlugins[i])};`,
    );
    pluginCalls.push(`  if (typeof ${varName} === "function") {
    await ${varName}({ h3App: app });
  }`);
  }

  return `
// Auto-generated worker entry point for ${preset}
import { createApp, createRouter, toWebHandler, defineEventHandler, toWebRequest } from "h3";
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server-build.js";

// API route handlers
${routeImports.join("\n")}

// Server plugins
${pluginImports.join("\n")}

let _handler;

async function getHandler() {
  if (_handler) return _handler;

  const app = createApp();
  const router = createRouter();
  app.use(router);

  // CORS
  app.use(defineEventHandler((event) => {
    const headers = event.node?.res || event.res;
    if (headers?.setHeader) {
      headers.setHeader("Access-Control-Allow-Origin", "*");
      headers.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      headers.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With");
    }
    if (event.method === "OPTIONS" || event.node?.req?.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
  }));

  // Register API routes
${routeRegistrations.join("\n")}

  // Run compatible plugins
${pluginCalls.join("\n")}

  // SSR catch-all for React Router
  const rrHandler = createRequestHandler(() => serverBuild);
  router.get("/**", defineEventHandler(async (event) => {
    const webReq = toWebRequest(event);
    return rrHandler(webReq);
  }));

  _handler = toWebHandler(app);
  return _handler;
}

export default {
  async fetch(request, env, ctx) {
    // Expose env bindings as process.env for compatibility
    if (env) {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
          globalThis.process = globalThis.process || { env: {} };
          globalThis.process.env = globalThis.process.env || {};
          globalThis.process.env[key] = value;
        }
      }
    }

    const handler = await getHandler();
    return handler(request);
  }
};
`;
}

/**
 * Build for Cloudflare Pages.
 * Output structure:
 *   dist/
 *     _worker.js       (bundled worker entry)
 *     assets/           (static client assets)
 */
async function buildCloudflarePages() {
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

  // Discover routes and plugins
  const routes = discoverApiRoutes(cwd);
  const plugins = discoverPlugins(cwd);

  console.log(
    `[deploy] ${routes.length} API routes, ${plugins.length} plugins (${plugins.filter((p) => isNodeOnlyPlugin(p)).length} skipped as Node-only)`,
  );

  // Generate the worker entry
  const entrySource = generateWorkerEntry(routes, plugins);

  // Create _worker.js output directory
  const workerOutDir = path.join(distDir, "_worker.js");
  fs.mkdirSync(workerOutDir, { recursive: true });

  // Copy the React Router server build (already bundled by Vite) directly
  // This avoids re-bundling the entire React SSR stack
  copyDir(serverDir, path.join(workerOutDir, "server"));

  // Write the worker entry — it imports from the copied server build
  const entryFile = path.join(workerOutDir, "index.js");

  // Rewrite the server-build import to point at the copied files
  const adjustedEntry = entrySource.replace(
    `import * as serverBuild from "./server-build.js";`,
    `import * as serverBuild from "./server/index.js";`,
  );

  // Write a temp file for esbuild to bundle (only the API routes + plugins + H3 wiring)
  const tmpDir = path.join(cwd, ".deploy-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpEntry = path.join(tmpDir, "worker-entry.js");
  fs.writeFileSync(tmpEntry, adjustedEntry);

  // Bundle with esbuild — only the worker entry + API routes.
  // The server build is external (already bundled by Vite).
  const esbuildBin = findEsbuild();

  execSync(
    [
      esbuildBin,
      tmpEntry,
      "--bundle",
      "--format=esm",
      "--target=es2022",
      "--platform=browser",
      "--minify",
      `--outfile=${entryFile}`,
      // Node.js compat — CF Workers supports these via nodejs_compat flag
      "--conditions=workerd,worker,import",
      // Keep the server build as external — it's already bundled
      `--external:./server/*`,
      // Externalize node builtins that Workers provides via compat
      ...getExternals(),
    ].join(" "),
    { stdio: "inherit", cwd },
  );

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true });

  // Report size
  const entrySize = fs.statSync(entryFile).size;
  const totalSize = getDirSize(workerOutDir);
  console.log(
    `[deploy] Cloudflare Pages output written to dist/ (worker entry: ${(entrySize / 1024).toFixed(0)}KB, total: ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
  );
}

function getExternals(): string[] {
  // All Node.js builtins — both bare and node: prefixed
  const names = [
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
  const builtins = [...names, ...names.map((n) => `node:${n}`)];
  return builtins.map((b) => `--external:${b}`);
}

function findEsbuild(): string {
  // Check local node_modules
  const localBin = path.resolve(cwd, "node_modules/.bin/esbuild");
  if (fs.existsSync(localBin)) return localBin;

  // Check workspace root
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

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Main
const SUPPORTED_PRESETS = ["cloudflare_pages"];

if (preset === "node") {
  // No post-processing needed for Node.js target
  process.exit(0);
}

if (!SUPPORTED_PRESETS.includes(preset)) {
  console.error(
    `[deploy] Unsupported preset: ${preset}. Supported: ${SUPPORTED_PRESETS.join(", ")}`,
  );
  process.exit(1);
}

console.log(`[deploy] Building for ${preset}...`);

switch (preset) {
  case "cloudflare_pages":
    await buildCloudflarePages();
    break;
}
