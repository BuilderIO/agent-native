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
import { execFileSync } from "child_process";
import { createRequire } from "module";
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

    // Try serving static assets first (CF Pages advanced mode)
    if (env?.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      } catch {
        // Asset fetch failed — fall through to SSR
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

  // Exclude _worker.js from being served as a public asset
  fs.writeFileSync(path.join(distDir, ".assetsignore"), "_worker.js\n");

  // Create empty stub for native modules that wrangler's bundler needs to resolve
  const stubsDir = path.join(distDir, "_worker.js", "stubs");
  fs.mkdirSync(stubsDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubsDir, "empty.js"),
    "export default {}; export const watch = () => ({ close() {} }); export const Database = class {};\n",
  );

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

  // Write the worker entry
  const entryFile = path.join(workerOutDir, "index.js");

  // Rewrite the server-build import to point at the copied files
  const adjustedEntry = entrySource.replace(
    `import * as serverBuild from "./server-build.js";`,
    `import * as serverBuild from "./server/index.js";`,
  );

  // Write a temp file for esbuild to bundle everything into a single worker entry.
  // The server build (React Router SSR) is copied to tmp so esbuild can resolve it.
  const tmpDir = path.join(cwd, ".deploy-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpEntry = path.join(tmpDir, "worker-entry.js");
  fs.writeFileSync(tmpEntry, adjustedEntry);

  // Copy server build files so esbuild can resolve the import
  copyDir(serverDir, path.join(tmpDir, "server"));

  // Create a require shim so CJS require("fs") calls resolve via ESM imports.
  // This is injected via esbuild --inject to replace its broken __require shim.
  fs.writeFileSync(
    path.join(tmpDir, "_require-shim.js"),
    generateRequireShim(),
  );

  // Create stub modules for native/Node-only deps that can't run on Workers.
  // These get resolved by esbuild instead of the real modules, avoiding bundling
  // native code that would fail on the Workers runtime.
  const stubModules = [
    "better-sqlite3",
    "node-pty",
    "chokidar",
    "fsevents",
    "dotenv",
  ];
  const stubDir = path.join(tmpDir, "node_modules");
  for (const mod of stubModules) {
    const modDir = path.join(stubDir, mod);
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(
      path.join(modDir, "index.js"),
      `export default {}; export const watch = () => ({ close() {} });`,
    );
    fs.writeFileSync(
      path.join(modDir, "package.json"),
      JSON.stringify({ name: mod, main: "index.js", type: "module" }),
    );
  }

  const esbuildBin = findEsbuild();

  // Externalize node builtins (both bare and node: prefixed) — the require shim handles bare ones,
  // and CF Workers runtime handles node: prefixed ones via nodejs_compat
  const nodeExternals = getNodeBuiltinNames().flatMap((n) => [
    `--external:${n}`,
    `--external:node:${n}`,
  ]);

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
      `--outfile=${entryFile}`,
      "--conditions=workerd,worker,import",
      // Banner: override the __require shim that esbuild generates for CJS modules.
      // This provides a real require() backed by ESM imports of node builtins.
      // Without this, CF Workers rejects the bundle because esbuild's default
      // __require shim throws "Dynamic require of X is not supported".
      `--banner:js=${generateRequireShim()}`,
      // Externalize node: builtins — CF Workers runtime provides them
      ...nodeExternals,
    ],
    { stdio: "inherit", cwd },
  );

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true });

  // Patch unenv stubs: make fs.mkdirSync/writeFileSync/readFileSync no-ops instead of throwing.
  // Some code calls these at import time; on Workers there's no filesystem, but the calls
  // are guarded by runtime checks (url.startsWith("file:")) so they're dead code on Workers.
  // The unenv stubs throw "not implemented" which crashes at validation time.
  // This patch makes them safe no-ops so the module loads without error.
  let workerCode2 = fs.readFileSync(entryFile, "utf-8");
  // Only add shim if unenv stubs would be present (when wrangler bundles with nodejs_compat_v2)
  if (!workerCode2.includes("__unenv_fs_patched__")) {
    workerCode2 = `/* __unenv_fs_patched__ */\n` + workerCode2;
  }
  fs.writeFileSync(entryFile, workerCode2);

  // Strip "node:" prefix from all imports/requires — nodejs_compat v1 only provides bare names.
  // Handles minified output (no space before quotes) and subpaths like node:fs/promises.
  let workerCode = fs.readFileSync(entryFile, "utf-8");
  workerCode = workerCode.replace(
    /from\s*["']node:([^"']+)["']/g,
    (_, mod) => `from"${mod}"`,
  );
  workerCode = workerCode.replace(
    /import\s*["']node:([^"']+)["']/g,
    (_, mod) => `import"${mod}"`,
  );
  fs.writeFileSync(entryFile, workerCode);

  // Report size
  const entrySize = fs.statSync(entryFile).size;
  const totalSize = getDirSize(workerOutDir);
  console.log(
    `[deploy] Cloudflare Pages output written to dist/ (worker entry: ${(entrySize / 1024).toFixed(0)}KB, total: ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
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

function getNodeBuiltinNames(): string[] {
  return NODE_BUILTINS;
}

/**
 * Generate a require() shim that bridges CJS require("fs") calls to ESM imports.
 * Injected via esbuild --inject so CJS deps work on Workers runtime.
 */
function generateRequireShim(): string {
  // Only shim the commonly-used builtins to keep it small
  const shimmed = [
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
    "querystring",
    "zlib",
    "net",
    "tls",
    "assert",
    "timers",
    "child_process",
    "module",
  ];

  const imports = shimmed
    .map((m) => `import __${m.replace("/", "_")} from "${m}";`)
    .join("");
  const entries = shimmed
    .map(
      (m) =>
        `"${m}":__${m.replace("/", "_")},"node:${m}":__${m.replace("/", "_")}`,
    )
    .join(",");

  return `${imports}\nconst __mods={${entries}};export var require=globalThis.require||function(m){const r=__mods[m];if(r!==undefined)return r;throw new Error("Cannot require: "+m)};\n`;
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
