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
import { fileURLToPath } from "url";
import {
  discoverApiRoutes,
  discoverPlugins,
  discoverActionFiles,
  getMissingDefaultPlugins,
  DEFAULT_PLUGIN_REGISTRY,
  type DiscoveredRoute,
  type DiscoveredAction,
} from "./route-discovery.js";
import {
  getWorkspaceCoreExports,
  type WorkspaceCoreExports,
} from "./workspace-core.js";

const cwd = process.cwd();
const preset = process.env.NITRO_PRESET || "node";

function normalizeConfiguredAppBasePath(): string {
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH;
  if (!raw || raw === "/") return "";
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "/") return "";
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

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
 *
 * If a workspace core is present (monorepo with `agent-native.workspaceCore`
 * configured and the named package resolves), any plugin slot that the
 * workspace core exports is imported from there instead of from
 * `@agent-native/core/server`. This is the middle layer of the three-layer
 * inheritance model: app local > workspace core > framework default.
 */
export function generateWorkerEntry(
  routes: DiscoveredRoute[],
  pluginPaths: string[],
  defaultPluginStems: string[] = [],
  actions: DiscoveredAction[] = [],
  workspaceCore: WorkspaceCoreExports | null = null,
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
    if (r.method.toLowerCase() === "get") {
      routeRegistrations.push(
        `  app.on("HEAD", ${JSON.stringify(r.route)}, defineEventHandler(async (event) => {
    const originalReq = event.req;
    event.req = requestWithMethod(event.req, "GET");
    try {
      const result = await ${varName}(event);
      const response = result instanceof Response ? result : toResponse(result, event);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      event.req = originalReq;
    }
  }));`,
      );
    }
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
      return new Response(JSON.stringify({ error: err?.message || "Action failed" }), { status: err?.message?.startsWith("Invalid action parameters") ? 400 : 500, headers: { "Content-Type": "application/json" } });
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

  // Auto-mounted default plugins (for slots the template doesn't override
  // locally). For each slot, prefer a workspace-core export over the
  // @agent-native/core default, if the workspace core provides one.
  const edgeDefaultStems = defaultPluginStems.filter(
    (stem) => !NODE_ONLY_PLUGINS.has(stem),
  );
  for (let i = 0; i < edgeDefaultStems.length; i++) {
    const stem = edgeDefaultStems[i];
    const varName = `defaultPlugin_${i}`;

    const workspaceExportName = workspaceCore?.plugins?.[stem as never];
    if (workspaceCore && workspaceExportName) {
      // Workspace-core layer wins over the framework default.
      pluginImports.push(
        `import { ${workspaceExportName} as ${varName} } from ${JSON.stringify(
          `${workspaceCore.packageName}/server`,
        )};`,
      );
    } else {
      // Fall back to the framework default from @agent-native/core.
      const defaultExportName = DEFAULT_PLUGIN_REGISTRY[stem];
      if (!defaultExportName) continue;
      pluginImports.push(
        `import { ${defaultExportName} as ${varName} } from "@agent-native/core/server";`,
      );
    }
    pluginCalls.push(`  if (typeof ${varName} === "function") {
    await ${varName}(nitroApp);
  }`);
  }

  return `
// Auto-generated worker entry point for ${preset}
import { H3, defineEventHandler, readBody, toResponse } from "h3";
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server-build.js";

function normalizeAppBasePath(value) {
  if (!value || value === "/") return "";
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "/") return "";
  return "/" + trimmed.replace(/^\\/+/, "").replace(/\\/+$/, "");
}

function getAppBasePath() {
  return normalizeAppBasePath(
    globalThis.process?.env?.VITE_APP_BASE_PATH ||
      globalThis.process?.env?.APP_BASE_PATH,
  );
}

function stripAppBasePath(pathname) {
  const basePath = getAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isFrameworkPath(pathname) {
  return (
    pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")
  );
}

function requestWithMountedApiPrefixStripped(request) {
  const basePath = getAppBasePath();
  if (!basePath) return request;
  const url = new URL(request.url);
  const strippedPathname = stripAppBasePath(url.pathname);
  if (strippedPathname === url.pathname) {
    return request;
  }
  if (!isApiPath(strippedPathname) && !isFrameworkPath(strippedPathname)) {
    return request;
  }
  url.pathname = strippedPathname;
  return new Request(url, request);
}

function prefixMountedPath(path, basePath) {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(basePath + "/")) return path;
  return basePath + path;
}

function prefixMountedHtml(html, basePath) {
  if (!basePath) return html;
  return html
    .replace(
      /\\b(href|src|action|formaction|poster)=(["'])(\\/(?!\\/)[^"']*)\\2/g,
      (_match, attr, quote, path) =>
        attr + "=" + quote + prefixMountedPath(path, basePath) + quote,
    )
    .replace(/url\\((["']?)(\\/(?!\\/)[^)'" ]+)\\1\\)/g, (_match, quote, path) => {
      const q = quote || "";
      return "url(" + q + prefixMountedPath(path, basePath) + q + ")";
    });
}

async function rewriteMountedResponse(response, basePath) {
  if (!basePath) return response;

  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location?.startsWith("/") && !location.startsWith("//")) {
    headers.set("location", prefixMountedPath(location, basePath));
  }

  const contentType = headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html") || !response.body) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.delete("content-length");
  return new Response(prefixMountedHtml(html, basePath), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestWithMethod(request, method) {
  return new Request(request.url, {
    method,
    headers: request.headers,
    signal: request.signal,
  });
}

function requestWithPathname(request, pathname) {
  const url = new URL(request.url);
  if (url.pathname === pathname) return request;
  url.pathname = pathname;
  return new Request(url, request);
}

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
          "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With,X-Request-Source",
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
    const basePath = getAppBasePath();
    const p = stripAppBasePath(new URL(event.req.url).pathname);
    if (
      p.startsWith("/.well-known/") ||
      p.startsWith("/_agent-native/") ||
      isApiPath(p) ||
      p === "/favicon.ico" ||
      p === "/favicon.png" ||
      (/\\.\\w+$/.test(p) && !p.endsWith(".data"))
    ) {
      return new Response(null, { status: 404 });
    }
    const request = requestWithPathname(event.req, p);
    if (event.req.method === "HEAD") {
      const getRequest = requestWithMethod(request, "GET");
      const response = await rrHandler(getRequest);
      return rewriteMountedResponse(
        new Response(null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        basePath,
      );
    }
    return rewriteMountedResponse(await rrHandler(request), basePath);
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

    // Try serving static assets first (CF Pages advanced mode).
    // Only attempt this for GET/HEAD — the ASSETS binding is a static file
    // server and returns 405 for any other method, which would short-circuit
    // API calls (PUT/POST/DELETE to /_agent-native/*) before they reach our
    // h3 middleware.
    if (env?.ASSETS && (request.method === "GET" || request.method === "HEAD")) {
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
    return handler(requestWithMountedApiPrefixStripped(request));
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

  // Write a package.json inside _worker.js/ to tell wrangler this is a
  // pre-bundled ES module worker — skip re-bundling our esbuild output.
  fs.mkdirSync(path.join(distDir, "_worker.js"), { recursive: true });
  fs.writeFileSync(
    path.join(distDir, "_worker.js", "package.json"),
    JSON.stringify({ main: "index.js", type: "module" }),
  );

  // Create empty stub for native modules that wrangler's bundler needs to resolve
  const stubsDir = path.join(distDir, "_worker.js", "stubs");
  fs.mkdirSync(stubsDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubsDir, "empty.js"),
    "export default {}; export const watch = () => ({ close() {} }); export const Database = class {};\n",
  );

  // Discover routes, plugins, actions, and the workspace core (if any).
  const routes = await discoverApiRoutes(cwd);
  const plugins = await discoverPlugins(cwd);
  const actions = await discoverActionFiles(cwd);
  const missingDefaults = await getMissingDefaultPlugins(cwd);
  const workspaceCore = await getWorkspaceCoreExports(cwd);

  const workspaceSlotCount = workspaceCore
    ? Object.keys(workspaceCore.plugins).length
    : 0;
  console.log(
    `[deploy] ${routes.length} API routes, ${actions.length} actions, ${plugins.length} plugins (${plugins.filter((p) => isNodeOnlyPlugin(p)).length} skipped as Node-only), ${missingDefaults.length} auto-mounted defaults${workspaceCore ? `, workspace-core ${workspaceCore.packageName} (${workspaceSlotCount} plugin slots)` : ""}`,
  );

  // Generate the worker entry
  const entrySource = generateWorkerEntry(
    routes,
    plugins,
    missingDefaults,
    actions,
    workspaceCore,
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
  // Name the entry "index.js" so esbuild outputs index.js in the outdir,
  // matching the _worker.js/index.js entry point that Cloudflare Pages expects.
  const tmpEntry = path.join(tmpDir, "index.js");
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

  // Externalize node builtins (both bare and node: prefixed) — the require
  // shim handles bare ones. Also alias every `node:*` specifier to its bare
  // name so esbuild emits `import from "fs"` everywhere, never
  // `import from "node:fs"`. CF Pages Functions (wrangler 3.x, nodejs_compat
  // v1) rejects the `node:` prefix in chunks with:
  //   No such module "node:fs" imported from chunks/...
  // The alias is the authoritative fix; the post-build strip stays as belt
  // & suspenders in case esbuild emits a node: string via some other path.
  const builtinNames = getNodeBuiltinNames();
  // Only externalize bare names. node:* externals would otherwise pin
  // the prefix in output; instead we alias node:* → bare so anything that
  // resolves past alias land as bare externals.
  const nodeExternals = builtinNames.map((n) => `--external:${n}`);
  const nodeAliases = builtinNames.map((n) => `--alias:node:${n}=${n}`);

  // Hard externalize large client-only / node-only libraries so they don't
  // bloat the edge worker. These are never executed in the CF Pages runtime
  // — mermaid/excalidraw render in the browser, pdf-parse and @google/genai
  // run from node-only action scripts. Without this, slides' bundle hits
  // the 25 MiB Pages Functions limit.
  const heavyClientExternals = [
    "mermaid",
    "@excalidraw/excalidraw",
    "@excalidraw/mermaid-to-excalidraw",
    "pdf-parse",
    "pdfjs-dist",
    "@google/genai",
    "chartjs-node-canvas",
    "@napi-rs/canvas",
  ].map((p) => `--external:${p}`);

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
      // Single-file bundle (no --splitting). CF Pages Functions' deploy
      // validator fails to load chunked _worker.js/ bundles even when the
      // chunks contain only bare node-builtin imports (wrangler 3.101.0
      // + nodejs_compat v2). Matches main's working config.
      `--outdir=${workerOutDir}`,
      "--conditions=workerd,worker,import",
      // The ssr-handler imports a virtual module that only exists at dev time
      "--external:virtual:react-router/server-build",
      // Banner: override the __require shim that esbuild generates for CJS modules.
      // This provides a real require() backed by ESM imports of node builtins.
      // Without this, CF Workers rejects the bundle because esbuild's default
      // __require shim throws "Dynamic require of X is not supported".
      `--banner:js=${generateRequireShim()}`,
      // Externalize node: builtins — CF Workers runtime provides them
      ...nodeExternals,
      ...heavyClientExternals,
      // Rewrite node:* -> bare names so chunks never contain node: imports
      ...nodeAliases,
    ],
    { stdio: "inherit", cwd },
  );

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true });

  // Rewrite the external virtual import to a local stub.
  // esbuild externalizes "virtual:react-router/server-build" (used by ssr-handler),
  // but wrangler re-bundles and chokes on it. Replace the import with a no-op stub.
  const virtualStub = path.join(workerOutDir, "chunks", "_virtual-stub.js");
  fs.mkdirSync(path.dirname(virtualStub), { recursive: true });
  fs.writeFileSync(virtualStub, "export default {};\n");

  // Post-build patches — apply to ALL .js files in the worker output directory
  // (entry + chunks) since code can land in any chunk after splitting.
  const allJsFiles = getAllJsFiles(workerOutDir);
  for (const jsFile of allJsFiles) {
    let code = fs.readFileSync(jsFile, "utf-8");
    const isEntry = path.basename(jsFile) === "index.js";

    // Strip "node:" prefix from all imports/requires. Cloudflare Pages
    // Functions runs under nodejs_compat v1, which exposes builtins as
    // bare names ("fs") and rejects "node:fs" at worker init:
    //   No such module "node:fs" imported from chunks/...
    // (Workers-on-the-edge use v2 and require the prefix; Pages lags.)
    // Preserve the original quote char (single vs double) when rewriting —
    // esbuild's minifier sometimes places `import('node:buffer')` inside a
    // double-quoted string literal; swapping to double quotes breaks the
    // outer literal and produces `Unexpected identifier 'buffer'`.
    code = code.replace(
      /\bfrom(\s*)(["'])node:([^"']+)\2/g,
      (_, ws, q, mod) => `from${ws}${q}${mod}${q}`,
    );
    code = code.replace(
      /\bimport(\s*)(["'])node:([^"']+)\2/g,
      (_, ws, q, mod) => `import${ws}${q}${mod}${q}`,
    );
    // Strip `node:` prefix from any string literal that names a node
    // builtin. Covers dynamic imports, require(), getBuiltinModule(),
    // and minified wrappers like `Ut("node:fs")` that Nitro/h3 emit.
    // Pages' loader scans chunks for `"node:*"` literals and fails with
    // 'No such module "node:fs"' whether or not the string is reached
    // at runtime. Scoping to known builtins avoids touching user data.
    const builtinsPattern = [
      "fs",
      "fs/promises",
      "path",
      "os",
      "crypto",
      "http",
      "https",
      "stream",
      "stream/web",
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
      "async_hooks",
      "process",
      "worker_threads",
      "sqlite",
    ].join("|");
    const builtinRe = new RegExp(`(["'])node:(${builtinsPattern})\\1`, "g");
    code = code.replace(
      builtinRe,
      (_, q: string, mod: string) => `${q}${mod}${q}`,
    );

    // Rewrite virtual:react-router/server-build imports to the local stub.
    // The generated entry handles SSR directly; this import is dead code from ssr-handler.
    const relStub = path
      .relative(path.dirname(jsFile), virtualStub)
      .replace(/\\/g, "/");
    code = code.replace(
      /["']virtual:react-router\/server-build["']/g,
      `"./${relStub}"`,
    );

    // Patch createRequire(import.meta.url) — import.meta.url is undefined in CF Workers.
    // Matches both `from "module"` and `from "node:module"` — with the node:
    // prefix preserved (for nodejs_compat_v2), the latter is what esbuild now emits.
    code = code.replace(
      /\bimport\s*\{\s*createRequire\s+as\s+([\w$]+)\s*\}\s*from\s*["'](?:node:)?module["']\s*;/g,
      "var $1 = function() { return typeof require !== 'undefined' ? require : function(m) { throw new Error('require not supported: ' + m); }; };",
    );

    // Patch setInterval/setTimeout at module scope — CF Workers disallows timers in global scope.
    // Some dependencies (e.g. Anthropic SDK rate limiter) call setInterval at module init.
    // With code splitting, chunks evaluate before the entry, so the shim must be in every file.
    // The restore only happens in the entry's fetch() handler.
    if (!code.includes("__origSetInterval")) {
      const timerShim = [
        "var __origSetInterval=globalThis.setInterval;",
        "globalThis.setInterval=function(){return{unref(){},ref(){},close(){}}};",
      ].join("");
      code = timerShim + code;
    }
    if (isEntry) {
      const timerRestore =
        "if(__origSetInterval)globalThis.setInterval=__origSetInterval;";
      code = code.replace(
        /async fetch\(request,\s*env,\s*ctx\)\s*\{/,
        (match) => match + timerRestore,
      );
    }

    fs.writeFileSync(jsFile, code);
  }

  // Report size
  const entrySize = fs.statSync(entryFile).size;
  const totalSize = getDirSize(workerOutDir);
  const chunkCount = allJsFiles.length - 1; // exclude entry
  console.log(
    `[deploy] Cloudflare Pages output written to dist/ (entry: ${(entrySize / 1024).toFixed(0)}KB, ${chunkCount} chunks, total: ${(totalSize / 1024 / 1024).toFixed(1)}MB)`,
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
  "sqlite",
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

export function getNodeBuiltinNames(): string[] {
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

  // Bare module names — CF Pages Functions runs under nodejs_compat v1,
  // which rejects "node:fs" and only accepts "fs". The post-build pass in
  // buildCloudflarePages() also strips any `node:` prefix that esbuild or
  // dependencies emit elsewhere.
  const imports = shimmed
    .map((m) => `import __${m.replace("/", "_")} from "${m}";`)
    .join("");
  // Only bare-name keys. Pages' Functions loader appears to scan chunks
  // for "node:*" string literals and pre-resolves them as module specs —
  // so keeping "node:fs" as an object key caused deploy to fail with
  // 'No such module "node:fs"' even though nothing imported it. The
  // post-build strip turns every runtime `require("node:fs")` into
  // `require("fs")` so bare keys are sufficient.
  const entries = shimmed
    .map((m) => `"${m}":__${m.replace("/", "_")}`)
    .join(",");

  const messageChannelPolyfill = `if(typeof MessageChannel==="undefined"){globalThis.MessageChannel=class{constructor(){const a={onmessage:null},b={onmessage:null};a.postMessage=d=>{if(b.onmessage)setTimeout(()=>b.onmessage({data:d}),0)};b.postMessage=d=>{if(a.onmessage)setTimeout(()=>a.onmessage({data:d}),0)};this.port1=a;this.port2=b}}}`;
  return `${imports}\n${messageChannelPolyfill}\nconst __mods={${entries}};export var require=globalThis.require||function(m){const r=__mods[m];if(r!==undefined)return r;throw new Error("Cannot require: "+m)};\n`;
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

/** Recursively collect all .js files in a directory. */
function getAllJsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllJsFiles(fullPath));
    } else if (entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
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
  const appBasePath = normalizeConfiguredAppBasePath();

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
  // Resolve the workspace core (if present) up front so the bundle embeds
  // enterprise-wide AGENTS.md + skills alongside the template's.
  const nitroWorkspaceCore = await getWorkspaceCoreExports(cwd);
  const nitroWorkspaceSource = nitroWorkspaceCore
    ? {
        skillsDir: nitroWorkspaceCore.skillsDir,
        agentsMdPath: nitroWorkspaceCore.agentsMdPath,
        rootDir: nitroWorkspaceCore.packageDir,
      }
    : null;
  const agentsBundleModuleSource = () => {
    const bundle = readAgentsBundleFromFs(cwd, nitroWorkspaceSource);
    return `// AUTO-GENERATED by @agent-native/core deploy build (Nitro virtual)
// Contains the inlined AGENTS.md + .agents/skills/ content from the template,
// merged with the workspace core's AGENTS.md + skills/ when present.
const bundle = ${JSON.stringify(bundle)};
export default bundle;
`;
  };

  // Path aliases used by templates (mirrors tsconfig + Vite config). Nitro
  // bundles server/ and actions/ with its own Rolldown pipeline that doesn't
  // see Vite's resolve.alias — so without this, action files that import
  // `@/foo` (= `app/foo`) end up with the literal `@/foo` specifier in the
  // serverless function output and crash at runtime with
  // "Cannot find package '@/foo' imported from /var/task/main.mjs".
  const appDir = path.join(cwd, "app");
  const sharedDir = path.join(cwd, "shared");
  const pathAliases: Record<string, string> = {};
  if (fs.existsSync(appDir)) pathAliases["@"] = appDir;
  if (fs.existsSync(sharedDir)) pathAliases["@shared"] = sharedDir;

  const nitro = await createNitro({
    rootDir: cwd,
    dev: false,
    preset,
    baseURL: appBasePath || "/",
    minify: true,
    serverDir: "./server",
    alias: {
      ...pathAliases,
      ...(fs.existsSync(rrServerBuild)
        ? { "virtual:react-router/server-build": rrServerBuild }
        : {}),
    },
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
    const basePath = appBasePath;
    if (basePath) {
      copyDir(clientDir, path.join(publicOutputDir, basePath.slice(1)));
    }
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
            "sqlite",
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
          "sqlite",
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

async function main() {
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
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
