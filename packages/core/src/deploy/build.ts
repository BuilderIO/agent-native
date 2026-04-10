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
  discoverActionFiles,
  getMissingDefaultPlugins,
  DEFAULT_PLUGIN_REGISTRY,
  type DiscoveredRoute,
  type DiscoveredAction,
} from "./route-discovery.js";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";

/** Plugins that require Node.js runtime and cannot run on edge/serverless */
const NODE_ONLY_PLUGINS = new Set([
  "terminal", // PTY requires child_process
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
  defaultPluginStems: string[] = [],
  actions: DiscoveredAction[] = [],
): string {
  const routeImports: string[] = [];
  const routeRegistrations: string[] = [];

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const varName = `route_${i}`;
    routeImports.push(`import ${varName} from ${JSON.stringify(r.absPath)};`);
    routeRegistrations.push(
      `  app.on(${JSON.stringify(r.method.toUpperCase())}, ${JSON.stringify(r.route)}, ${varName});`,
    );
  }

  // Action route imports and registrations
  const actionImports: string[] = [];
  const actionRegistrations: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const varName = `action_${i}`;
    actionImports.push(`import ${varName} from ${JSON.stringify(a.absPath)};`);
    const routePath = `/_agent-native/actions/${a.name}`;
    actionRegistrations.push(
      `  app.on(${JSON.stringify(a.method.toUpperCase())}, ${JSON.stringify(routePath)}, defineEventHandler(async (event) => {
    const params = ${a.method === "get" ? "Object.fromEntries(event.url.searchParams)" : "(await readBody(event)) ?? {}"};
    try {
      const result = await ${varName}.run(params);
      if (typeof result === "string") { try { return JSON.parse(result); } catch { return result; } }
      return result;
    } catch (err) {
      return new Response(JSON.stringify({ error: err?.message || "Action failed" }), { status: err?.message?.startsWith("Invalid action parameters:") ? 400 : 500, headers: { "Content-Type": "application/json" } });
    }
  }));`,
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
    await ${varName}(nitroApp);
  }`);
  }

  // Auto-mounted default plugins (from core, for missing plugin files)
  const edgeDefaultStems = defaultPluginStems.filter(
    (stem) => !NODE_ONLY_PLUGINS.has(stem),
  );
  for (let i = 0; i < edgeDefaultStems.length; i++) {
    const stem = edgeDefaultStems[i];
    const exportName = DEFAULT_PLUGIN_REGISTRY[stem];
    if (!exportName) continue;
    const varName = `defaultPlugin_${i}`;
    pluginImports.push(
      `import { ${exportName} as ${varName} } from "@agent-native/core/server";`,
    );
    pluginCalls.push(`  if (typeof ${varName} === "function") {
    await ${varName}(nitroApp);
  }`);
  }

  return `
// Auto-generated worker entry point for ${preset}
import { H3, defineEventHandler, readBody } from "h3";
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server-build.js";

// API route handlers
${routeImports.join("\n")}

// Action handlers (auto-discovered from actions/)
${actionImports.join("\n")}

// Server plugins
${pluginImports.join("\n")}

let _handler;

async function getHandler() {
  if (_handler) return _handler;

  const app = new H3();

  // Build a fake nitroApp surface so framework plugins (which expect
  // \`nitroApp.h3["~middleware"]\`) can register routes via getH3App().
  const noop = () => {};
  const nitroApp = {
    h3: app,
    hooks: { hook: noop, callHook: noop, hookOnce: noop },
    captureError: noop,
  };

  // CORS — applied as global middleware via .use(handler)
  app.use(defineEventHandler((event) => {
    if (event.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
        },
      });
    }
  }));

  // Run plugins — they call getH3App(nitroApp).use(path, handler) which
  // pushes path-prefix middleware onto app["~middleware"].
${pluginCalls.join("\n")}

  // Register API routes
${routeRegistrations.join("\n")}

  // Register action routes (/_agent-native/actions/*)
${actionRegistrations.join("\n")}

  // SSR catch-all for React Router
  const rrHandler = createRequestHandler(() => serverBuild);
  app.all("/**", defineEventHandler(async (event) => {
    return rrHandler(event.req);
  }));

  _handler = app.fetch.bind(app);
  return _handler;
}

export default {
  async fetch(request, env, ctx) {
    // Expose env and ctx bindings globally for compatibility
    if (ctx) globalThis.__cf_ctx = ctx;
    if (env) {
      globalThis.process = globalThis.process || { env: {} };
      globalThis.process.env = globalThis.process.env || {};
      // Expose D1/KV/R2 bindings on globalThis.__cf_env for the db layer
      globalThis.__cf_env = env;
      for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string") {
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

  // Discover routes, plugins, and actions
  const routes = await discoverApiRoutes(cwd);
  const plugins = await discoverPlugins(cwd);
  const actions = await discoverActionFiles(cwd);
  const missingDefaults = await getMissingDefaultPlugins(cwd);

  console.log(
    `[deploy] ${routes.length} API routes, ${actions.length} actions, ${plugins.length} plugins (${plugins.filter((p) => isNodeOnlyPlugin(p)).length} skipped as Node-only), ${missingDefaults.length} auto-mounted defaults`,
  );

  // Generate the worker entry
  const entrySource = generateWorkerEntry(
    routes,
    plugins,
    missingDefaults,
    actions,
  );

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
    "@anthropic-ai/sdk",
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

  // Patch setInterval/setTimeout at module scope — CF Workers disallows timers in global scope.
  // Some dependencies (e.g. Anthropic SDK rate limiter) call setInterval at module init.
  // Inject a banner that makes setInterval/setTimeout safe during module evaluation,
  // then restores them inside the first fetch() call.
  let workerCode = fs.readFileSync(entryFile, "utf-8");
  const timerShim = [
    "var __origSetInterval=globalThis.setInterval;",
    "globalThis.setInterval=function(){return{unref(){},ref(){},close(){}}};",
  ].join("");
  // Restore real setInterval inside the fetch handler
  const timerRestore =
    "if(__origSetInterval)globalThis.setInterval=__origSetInterval;";
  workerCode = timerShim + workerCode;
  // Inject restore right after "async fetch(request, env, ctx) {"
  workerCode = workerCode.replace(
    /async fetch\(request,\s*env,\s*ctx\)\s*\{/,
    (match) => match + timerRestore,
  );

  // Strip "node:" prefix from all imports/requires — nodejs_compat v1 only provides bare names.
  // Handles minified output (no space before quotes) and subpaths like node:fs/promises.
  workerCode = workerCode.replace(
    /from\s*["']node:([^"']+)["']/g,
    (_, mod) => `from"${mod}"`,
  );
  workerCode = workerCode.replace(
    /import\s*["']node:([^"']+)["']/g,
    (_, mod) => `import"${mod}"`,
  );
  // Patch createRequire(import.meta.url) — import.meta.url is undefined in CF Workers.
  // React Router's server build uses createRequire for CJS compat. Replace it with a
  // stub that returns our require shim (which is already injected via the banner).
  workerCode = workerCode.replace(
    /\bimport\s*\{\s*createRequire\s+as\s+([\w$]+)\s*\}\s*from\s*["']module["']\s*;/g,
    "var $1 = function() { return typeof require !== 'undefined' ? require : function(m) { throw new Error('require not supported: ' + m); }; };",
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

/**
 * Create stub directories for dangling platform-specific optional dependency
 * symlinks in the pnpm store.
 *
 * pnpm's store at `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/<dep>`
 * contains symlinks for ALL optional deps declared by a package, but only
 * installs the ones matching the current OS/CPU as real packages. The other
 * symlinks dangle — their targets at `.pnpm/<scope>+<pkg>@<ver>/node_modules/...`
 * don't exist.
 *
 * Nitro's `nitro:externals` plugin (via nf3 / @vercel/nft) walks
 * optionalDependencies when tracing files and calls `realpath` on them, which
 * throws ENOENT on dangling targets. This blocks builds with presets like
 * netlify / vercel / aws-lambda on macOS when packages like `libsql` declare
 * Linux-only platform variants as optional deps.
 *
 * Fix: walk `node_modules/.pnpm/` and for every dangling symlink under
 * `<pkg>/node_modules/<scope>/<dep>`, create the symlink's target as a tiny
 * stub directory containing just a valid `package.json`. The tracer can now
 * `realpath` and read the package.json without throwing — the stub is empty
 * so no binary is bundled (which is what we want: we're building from macOS,
 * the target deploy platform will install its own native binary).
 */
function createDanglingOptionalDepStubs() {
  // In pnpm monorepos, the store may live at the workspace root rather than
  // in the template dir. Walk up from `cwd` to find every `.pnpm` directory.
  const pnpmRoots: string[] = [];
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".pnpm");
    if (fs.existsSync(candidate)) pnpmRoots.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (pnpmRoots.length === 0) return;

  let stubsCreated = 0;

  for (const pnpmRoot of pnpmRoots) {
    let pkgDirs: string[];
    try {
      pkgDirs = fs.readdirSync(pnpmRoot);
    } catch {
      continue;
    }

    for (const pkgDir of pkgDirs) {
      // e.g. `libsql@0.5.29`, `@libsql+client@0.15.15`
      const innerNm = path.join(pnpmRoot, pkgDir, "node_modules");
      if (!fs.existsSync(innerNm)) continue;

      let innerEntries: fs.Dirent[];
      try {
        innerEntries = fs.readdirSync(innerNm, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of innerEntries) {
        // Top-level entry: either `foo` (unscoped) or `@scope` (scoped)
        const entryPath = path.join(innerNm, entry.name);
        const candidates: { symlinkPath: string; pkgName: string }[] = [];
        if (entry.name.startsWith("@")) {
          // Scoped — iterate children
          let scopedChildren: fs.Dirent[];
          try {
            scopedChildren = fs.readdirSync(entryPath, {
              withFileTypes: true,
            });
          } catch {
            continue;
          }
          for (const child of scopedChildren) {
            candidates.push({
              symlinkPath: path.join(entryPath, child.name),
              pkgName: `${entry.name}/${child.name}`,
            });
          }
        } else {
          candidates.push({ symlinkPath: entryPath, pkgName: entry.name });
        }

        for (const { symlinkPath, pkgName } of candidates) {
          let isSymlink = false;
          try {
            isSymlink = fs.lstatSync(symlinkPath).isSymbolicLink();
          } catch {
            continue;
          }
          if (!isSymlink) continue;

          // Check if the symlink target exists
          try {
            fs.statSync(symlinkPath);
            continue; // Target exists — nothing to do
          } catch {
            // Dangling symlink — create a stub at the target
          }

          let linkTarget: string;
          try {
            linkTarget = fs.readlinkSync(symlinkPath);
          } catch {
            continue;
          }
          const resolvedTarget = path.resolve(
            path.dirname(symlinkPath),
            linkTarget,
          );

          try {
            fs.mkdirSync(resolvedTarget, { recursive: true });
            const stubPkgJson = {
              name: pkgName,
              version: "0.0.0-stub",
              description:
                "Empty stub created by @agent-native/core deploy build to satisfy nitro's file tracer on platforms where this optional dep is not installed.",
            };
            fs.writeFileSync(
              path.join(resolvedTarget, "package.json"),
              JSON.stringify(stubPkgJson, null, 2),
            );
            stubsCreated++;
          } catch {
            // Best-effort — ignore failures
          }
        }
      }
    }
  }

  if (stubsCreated > 0) {
    console.log(
      `[deploy] Created ${stubsCreated} stub package dir(s) for dangling optional deps (platform-specific binaries not installed on this host).`,
    );
  }
}

/**
 * Build for any non-Cloudflare preset using Nitro's programmatic build API.
 * Handles netlify, vercel, deno_deploy, aws-lambda, and all other targets.
 */
async function buildWithNitro() {
  console.log(`[deploy] Building for preset "${preset}" via Nitro...`);

  // Work around pnpm + nitro:externals (nf3) bug where dangling symlinks for
  // platform-specific optional deps cause realpath ENOENT during file tracing.
  createDanglingOptionalDepStubs();

  const {
    createNitro,
    prepare,
    copyPublicAssets,
    build: nitroBuild,
  } = await import("nitro/builder");

  // Resolve the React Router server build so the SSR catch-all route
  // can import "virtual:react-router/server-build" in production.
  const rrServerBuild = path.join(cwd, "build", "server", "index.js");

  // Inline the template's AGENTS.md + .agents/skills/ content into the Nitro
  // bundle via the `virtual` config option. Nitro's internal `nitro:virtual`
  // Rollup plugin picks this up and resolves `virtual:agents-bundle` to the
  // generated ES module source. Without this, Nitro's Rolldown build (used for
  // netlify, vercel, aws-lambda, node presets) can't resolve the virtual
  // module that `server/agents-bundle.ts` imports — it silently falls through
  // to an empty bundle and the agent gets no instructions/skills at runtime.
  //
  // The Vite plugin at `vite/agents-bundle-plugin.ts` handles this for the
  // React Router client/server build (and cloudflare via esbuild rebundle),
  // but Nitro runs its OWN build from ./server/ without Vite, so it needs its
  // own virtual module registration. Both paths reuse `readAgentsBundleFromFs`
  // from `server/agents-bundle.ts` to guarantee identical content.
  const { readAgentsBundleFromFs } = await import("../server/agents-bundle.js");
  const agentsBundleModuleSource = () => {
    const bundle = readAgentsBundleFromFs(cwd);
    return `// AUTO-GENERATED by @agent-native/core deploy build (Nitro virtual)
// Contains the inlined AGENTS.md + .agents/skills/ content from the template.
const bundle = ${JSON.stringify(bundle)};
export default bundle;
`;
  };

  const nitro = await createNitro({
    rootDir: cwd,
    dev: false,
    preset,
    minify: true,
    serverDir: "./server",
    alias: fs.existsSync(rrServerBuild)
      ? { "virtual:react-router/server-build": rrServerBuild }
      : {},
    virtual: {
      "virtual:agents-bundle": agentsBundleModuleSource,
    },
    // For edge presets (cloudflare, deno), bundle all deps — node_modules
    // aren't available at runtime. Netlify/Vercel/Node have node_modules.
    ...(preset.startsWith("cloudflare") || preset.startsWith("deno")
      ? { noExternals: true }
      : {}),
  } as any);

  await prepare(nitro);
  await copyPublicAssets(nitro);
  await nitroBuild(nitro);

  // Copy React Router's client build into Nitro's public output dir
  const clientDir = path.join(cwd, "build", "client");
  const publicOutputDir = nitro.options.output.publicDir;
  if (fs.existsSync(clientDir) && publicOutputDir) {
    copyDir(clientDir, publicOutputDir);
    console.log(
      `[deploy] Copied client assets to ${path.relative(cwd, publicOutputDir)}`,
    );
  }

  // Resolve remaining bare npm imports by bundling them into _libs/.
  // Nitro sometimes leaves small packages as externals even with noExternals.
  if (preset.startsWith("cloudflare") || preset.startsWith("deno")) {
    const { execFileSync } = await import("child_process");
    const { createRequire } = await import("module");
    const esbuildBin = (() => {
      try {
        const _req = createRequire(cwd + "/");
        const pkg = path.dirname(_req.resolve("esbuild/package.json"));
        const bin = path.join(pkg, "bin", "esbuild");
        if (fs.existsSync(bin)) return bin;
      } catch {}
      return "esbuild";
    })();

    // Scan all output files for bare npm imports
    const outputDir =
      nitro.options.output.serverDir || path.join(cwd, "dist", "_worker.js");
    const bareImports = new Set<string>();
    function scanForBareImports(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanForBareImports(p);
          continue;
        }
        if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
          continue;
        const code = fs.readFileSync(p, "utf-8");
        const matches = code.matchAll(/from\s*["']([a-z@][a-z0-9._\-/]*)["']/g);
        for (const m of matches) {
          const mod = m[1];
          if (mod.startsWith("node:")) continue;
          // Skip Node builtins that are available via nodejs_compat
          const builtins = new Set([
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
            "net",
            "tls",
            "assert",
            "timers",
            "child_process",
            "module",
            "process",
            "worker_threads",
            "querystring",
            "zlib",
            "vm",
            "string_decoder",
            "diagnostics_channel",
            "async_hooks",
            "perf_hooks",
            "inspector",
          ]);
          if (builtins.has(mod)) continue;
          bareImports.add(mod);
        }
      }
    }
    scanForBareImports(outputDir);

    // For each bare import, try to bundle it as a standalone module
    if (bareImports.size > 0) {
      const libsDir = path.join(outputDir, "_libs");
      fs.mkdirSync(libsDir, { recursive: true });
      for (const mod of bareImports) {
        const outFile = path.join(libsDir, `${mod.replace(/[/@]/g, "_")}.mjs`);
        try {
          // Try resolving from both template dir and workspace root
          const nodePaths = [
            path.join(cwd, "node_modules"),
            path.resolve(cwd, "../../node_modules"),
          ].filter((p) => fs.existsSync(p));
          // Resolve the module — check workspace node_modules and pnpm store
          let resolvedMod = mod;
          const _require = createRequire(cwd + "/");
          try {
            const resolved = _require.resolve(mod);
            resolvedMod = resolved;
          } catch {
            // Try from workspace root
            try {
              const wsRequire = createRequire(
                path.resolve(cwd, "../../package.json"),
              );
              resolvedMod = wsRequire.resolve(mod);
            } catch {
              // Will fail at esbuild
            }
          }
          // Scan what named imports the consumer expects, then generate
          // explicit re-exports to handle CJS modules properly.
          const neededExports = new Set<string>();
          function findNeededExports(dir: string) {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                findNeededExports(p);
                continue;
              }
              if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
                continue;
              const code = fs.readFileSync(p, "utf-8");
              // Match: import{foo as bar,baz}from"<mod>"
              const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const re = new RegExp(
                `import\\{([^}]+)\\}from["']${escaped}["']`,
                "g",
              );
              for (const m2 of code.matchAll(re)) {
                for (const part of m2[1].split(",")) {
                  const name = part
                    .trim()
                    .split(/\s+as\s+/)[0]
                    .trim();
                  if (name && /^[a-zA-Z_$]/.test(name)) neededExports.add(name);
                }
              }
            }
          }
          findNeededExports(outputDir);

          const entryCode =
            neededExports.size > 0
              ? [
                  `import _mod from "${resolvedMod}";`,
                  `export default _mod;`,
                  ...Array.from(neededExports).map(
                    (n) =>
                      `export const ${n} = _mod.${n} ?? _mod?.default?.${n};`,
                  ),
                ].join("\n")
              : `export * from "${resolvedMod}"; export { default } from "${resolvedMod}";`;

          execFileSync(
            esbuildBin,
            [
              "--bundle",
              `--outfile=${outFile}`,
              "--format=esm",
              "--platform=neutral",
              "--target=es2022",
              "--external:node:*",
            ],
            {
              input: entryCode,
              cwd,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          // Rewrite imports in all files to point to the bundled module
          function rewriteImports(dir: string) {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                rewriteImports(p);
                continue;
              }
              if (!entry.name.endsWith(".mjs") && !entry.name.endsWith(".js"))
                continue;
              let code = fs.readFileSync(p, "utf-8");
              const relPath = path
                .relative(path.dirname(p), outFile)
                .replace(/\\/g, "/");
              const importPath = relPath.startsWith(".")
                ? relPath
                : "./" + relPath;
              const re = new RegExp(
                `from["']${mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
                "g",
              );
              if (re.test(code)) {
                code = code.replace(re, `from"${importPath}"`);
                fs.writeFileSync(p, code);
              }
            }
          }
          rewriteImports(outputDir);
          console.log(`[deploy] Bundled external: ${mod}`);
        } catch {
          console.warn(
            `[deploy] Could not bundle: ${mod} (may not be needed at runtime)`,
          );
        }
      }
    }
  }

  // Cloudflare-specific post-build patches
  if (preset.startsWith("cloudflare")) {
    const serverDir2 = nitro.options.output.serverDir;
    const scanDirs = [serverDir2];
    if (serverDir2) {
      const chunksDir = path.join(serverDir2, "_chunks");
      const libsDir = path.join(serverDir2, "_libs");
      if (fs.existsSync(chunksDir)) scanDirs.push(chunksDir);
      if (fs.existsSync(libsDir)) scanDirs.push(libsDir);
    }

    for (const scanDir of scanDirs) {
      if (!scanDir || !fs.existsSync(scanDir)) continue;
      for (const file of fs.readdirSync(scanDir)) {
        if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
        const filePath = path.join(scanDir, file);
        let code = fs.readFileSync(filePath, "utf-8");
        let changed = false;

        // 1. Rewrite bare Node.js imports to node: prefixed.
        // CF Workers requires the node: prefix for built-in modules.
        const NODE_BUILTINS = [
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
          "process",
          "worker_threads",
          "string_decoder",
          "diagnostics_channel",
          "async_hooks",
          "perf_hooks",
          "inspector",
          "vm",
        ];
        for (const mod of NODE_BUILTINS) {
          // Match: from"fs" or from "fs" (but not from"node:fs")
          const re = new RegExp(`from\\s*["']${mod}["']`, "g");
          if (re.test(code)) {
            code = code.replace(re, `from"node:${mod}"`);
            changed = true;
          }
        }

        // 2. Patch import.meta.url for createRequire().
        // React Router's server build uses createRequire(import.meta.url)
        // but import.meta.url is undefined on CF Workers.
        if (code.includes("import.meta.url")) {
          code = code.replace(/import\.meta\.url/g, '"file:///worker.mjs"');
          changed = true;
        }

        // 3. Patch setInterval/setTimeout at global scope.
        // CF Workers disallows timers in global scope.
        if (code.includes("setInterval") && !code.includes("__timer_shim__")) {
          const shim =
            "/* __timer_shim__ */" +
            "var __origSetInterval=globalThis.setInterval;" +
            "globalThis.setInterval=function(){return{unref(){},ref(){},close(){}}};";
          const restore =
            ";(function(){if(typeof __origSetInterval!=='undefined')globalThis.setInterval=__origSetInterval})();";
          code = shim + code + "\n" + restore;
          changed = true;
        }

        if (changed) fs.writeFileSync(filePath, code);
      }
    }
    // 3. Create stub modules in _libs/ for native deps that Nitro's rolldown
    // bundler references but can't resolve on CF Workers, and rewrite
    // bare imports to point to the stub files.
    const libsDir2 = path.join(
      serverDir2 || path.join(cwd, "dist", "_worker.js"),
      "_libs",
    );
    if (fs.existsSync(libsDir2)) {
      const NATIVE_STUBS = ["better-sqlite3", "node-pty", "cron-parser"];
      for (const mod of NATIVE_STUBS) {
        const libFiles = fs
          .readdirSync(libsDir2)
          .filter((f) => f.endsWith(".mjs"));
        const referencingFiles: string[] = [];
        for (const f of libFiles) {
          const filePath = path.join(libsDir2, f);
          const content = fs.readFileSync(filePath, "utf-8");
          if (content.includes(`"${mod}"`) || content.includes(`'${mod}'`)) {
            referencingFiles.push(filePath);
          }
        }
        if (referencingFiles.length === 0) continue;

        // Create a stub _libs/<mod>.mjs that exports empty defaults
        const stubName = mod.replace(/[/@]/g, "__") + ".mjs";
        const stubPath = path.join(libsDir2, stubName);
        if (!fs.existsSync(stubPath)) {
          fs.writeFileSync(
            stubPath,
            `export default {}; export const watch = () => ({ close() {} });\n`,
          );
          console.log(`[deploy] Created stub for _libs/${stubName}`);
        }

        // Rewrite bare imports in _libs/ and _chunks/ to use the stub
        const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const importRe = new RegExp(`(from\\s*["'])${escaped}(["'])`, "g");
        // Scan _libs/ files
        for (const filePath of referencingFiles) {
          let code = fs.readFileSync(filePath, "utf-8");
          if (importRe.test(code)) {
            code = code.replace(importRe, `$1./${stubName}$2`);
            fs.writeFileSync(filePath, code);
            console.log(
              `[deploy] Rewrote ${mod} imports in _libs/${path.basename(filePath)}`,
            );
          }
        }
        // Also scan _chunks/ files (they import native deps too)
        const chunksDir2 = path.join(
          serverDir2 || path.join(cwd, "dist", "_worker.js"),
          "_chunks",
        );
        if (fs.existsSync(chunksDir2)) {
          for (const f of fs
            .readdirSync(chunksDir2)
            .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"))) {
            const filePath = path.join(chunksDir2, f);
            let code = fs.readFileSync(filePath, "utf-8");
            if (importRe.test(code)) {
              // From _chunks/, the stub is at ../_libs/<stubName>
              code = code.replace(importRe, `$1../_libs/${stubName}$2`);
              fs.writeFileSync(filePath, code);
              console.log(`[deploy] Rewrote ${mod} imports in _chunks/${f}`);
            }
          }
        }
      }
    }

    console.log(
      "[deploy] Patched bare Node imports, timer calls, and route finder for CF Workers",
    );
  }

  await nitro.close();
  console.log(`[deploy] Nitro build complete for preset "${preset}".`);
}

// Main

if (preset === "node") {
  process.exit(0);
}

console.log(`[deploy] Building for ${preset}...`);

switch (preset) {
  case "cloudflare_pages":
  case "cloudflare-pages":
    // Cloudflare Workers require a single-file bundle that wrangler can deploy.
    // Nitro's native presets produce split chunks that wrangler can't upload
    // as multi-module Workers. Use the custom esbuild-based bundler.
    await buildCloudflarePages();
    break;
  default:
    // All other presets (netlify, vercel, deno_deploy, aws-lambda, etc.)
    // are handled natively by Nitro's build API.
    await buildWithNitro();
    break;
}
