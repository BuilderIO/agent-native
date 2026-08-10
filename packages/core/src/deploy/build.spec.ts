import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_CHAT_PROCESS_RUN_PATH,
  isAgentChatDurableBackgroundEnabled,
} from "../agent/durable-background.js";
import {
  DEFAULT_SSR_CACHE_HEADERS,
  DISABLED_SSR_CACHE_HEADERS,
  ssrCacheHeadersForPolicy,
} from "../shared/cache-control.js";
import {
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
} from "../shared/social-meta.js";
import {
  addImmutableAssetRouteRulesForClientBuild,
  assertEmittedBackgroundFunctionOnDisk,
  assertNoCloudflareWorkerStubDynamicImports,
  assertSingleTemplateNetlifyBuildOutput,
  bundleYjsRuntimeForServerlessOutput,
  CLOUDFLARE_WORKER_ESBUILD_EXTERNALS,
  CLOUDFLARE_MODULE_STUB_MODULES,
  CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES,
  CLOUDFLARE_WORKER_STUB_MODULES,
  CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES,
  cloudflareWorkerStubAliasArgs,
  configureCloudflareModuleWorkerOutput,
  copyInstalledBrowserRuntimePackages,
  copyDir,
  createCloudflareModuleStubPlugin,
  emitSingleTemplateNetlifyBackgroundFunction,
  emitSingleTemplateNetlifyIntegrationRecoveryFunction,
  emitSingleTemplateNetlifyKeepWarmFunction,
  emitSingleTemplateNetlifyRecurringJobsFunction,
  findInstalledFfmpegStaticPackage,
  findInstalledPackageRoot,
  findInstalledResvgPackages,
  findServerlessBrowserRuntimeConsumer,
  isServerlessNativePlatformPackage,
  generateCloudflarePagesStaticShellFromManifest,
  generateCloudflareModuleWorkerEntry,
  generateProvidedPluginsNitroPluginSource,
  generateWorkerEntry,
  getNodeBuiltinNames,
  isCloudflareModulePreset,
  isDurableBackgroundDeployEnabled,
  isIntegrationDurableDispatchDeployEnabled,
  isKeepWarmBackgroundDeployEnabled,
  isKeepWarmDeployEnabled,
  resolveKeepWarmSchedule,
  NETLIFY_RECURRING_JOBS_FUNCTION_NAME,
  NITRO_RUNTIME_IGNORE_PATTERNS,
  nitroNoExternalsForPreset,
  patchCloudflareModuleNitroEntry,
  pruneServerlessFunctionDeadWeight,
  resolveNitroBundledYjsEntry,
  resolveNitroBuildReplacements,
  runNitroBuildPipeline,
  sanitizeServerlessFunctionPackageManifest,
  shouldBundleFfmpegStaticForServerless,
  writeSingleTemplateNetlifyRedirects,
} from "./build.js";
import { IMMUTABLE_ASSET_CACHE_CONTROL } from "./immutable-assets.js";

const tempDirs: string[] = [];

describe("nitroNoExternalsForPreset", () => {
  it("leaves Yjs external for the controlled serverless bundling pass", () => {
    expect(nitroNoExternalsForPreset("netlify")).toEqual([]);
    expect(nitroNoExternalsForPreset("vercel")).toEqual([]);
    expect(nitroNoExternalsForPreset("aws-lambda")).toEqual([]);
    expect(nitroNoExternalsForPreset("node-server")).toEqual(["yjs"]);
  });

  it("bundles every dependency for edge output", () => {
    expect(nitroNoExternalsForPreset("cloudflare-pages")).toBe(true);
    expect(nitroNoExternalsForPreset("cloudflare_module")).toBe(true);
    expect(nitroNoExternalsForPreset("deno-deploy")).toBe(true);
  });
});

describe("resolveNitroBuildReplacements", () => {
  it("embeds release migration ownership into the Nitro server bundle", () => {
    const replacements = resolveNitroBuildReplacements({
      AGENT_NATIVE_RELEASE_MIGRATIONS: " 1 ",
    });

    expect(replacements["process.env.AGENT_NATIVE_RELEASE_MIGRATIONS"]).toBe(
      JSON.stringify("1"),
    );
  });
});

describe("isCloudflareModulePreset", () => {
  it("recognizes Nitro's module preset and its CLI spelling", () => {
    expect(isCloudflareModulePreset("cloudflare_module")).toBe(true);
    expect(isCloudflareModulePreset("cloudflare-module")).toBe(true);
    expect(isCloudflareModulePreset("cloudflare_pages")).toBe(false);
  });
});

describe("Cloudflare module Worker entry", () => {
  it("defers Nitro's handler and lifecycle initialization", () => {
    const source =
      'function ki(e){let t=Ei(),n=Di();return{async fetch(n,r,i){globalThis.__env__=r,g(n,{env:r,context:i});return await t.fetch(n)},scheduled(e,t,r){r.waitUntil(n.callHook("scheduled",e))}}';

    const patched = patchCloudflareModuleNitroEntry(source);

    expect(patched).toContain("let t,n;");
    expect(patched).toContain("t??=Ei();");
    expect(patched).toContain('(n??=Di()).callHook("scheduled",e)');
    expect(patched).not.toContain("let t=Ei(),n=Di();");
  });

  it("defers Nitro initialization until bindings are available", () => {
    const entry = generateCloudflareModuleWorkerEntry();

    expect(entry).toContain("globalThis.__env__ = env;");
    expect(entry).not.toContain("globalThis.__cf_ctx");
    expect(entry).toContain("request.waitUntil = ctx.waitUntil.bind(ctx);");
    expect(entry).toContain("function initializeBindings(env)");
    expect(entry).toContain('export * from "./index.mjs";');
    expect(entry).toContain(
      "initializeBindings(env);\n    return (await loadHandler())",
    );
    expect(entry).toContain('await import("./index.mjs")');
    expect(entry).toContain(
      "return (await loadHandler()).fetch(request, env, ctx);",
    );
    expect(entry).toContain("async scheduled(controller, env, ctx)");
    expect(entry).toContain("async queue(batch, env, ctx)");
    expect(entry).toContain("async email(message, env, ctx)");
    expect(entry).toContain("async tail(traces, env, ctx)");
    expect(entry).toContain("async trace(traces, env, ctx)");
  });

  it("points Wrangler at the lazy entry while retaining the Nitro server", () => {
    const serverDir = makeTempDir();
    fs.writeFileSync(
      path.join(serverDir, "wrangler.json"),
      JSON.stringify({ main: "index.mjs", assets: { binding: "ASSETS" } }),
    );
    fs.writeFileSync(
      path.join(serverDir, "index.mjs"),
      'function ki(e){let t=Ei(),n=Di();return{async fetch(n,r,i){globalThis.__env__=r,g(n,{env:r,context:i});return await t.fetch(n)},scheduled(e,t,r){r.waitUntil(n.callHook("scheduled",e))}}',
    );

    configureCloudflareModuleWorkerOutput(serverDir);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(serverDir, "wrangler.json"), "utf8"),
      ),
    ).toMatchObject({
      main: "worker.mjs",
      assets: { binding: "ASSETS" },
    });
    expect(
      fs.readFileSync(path.join(serverDir, "worker.mjs"), "utf8"),
    ).toContain('await import("./index.mjs")');
    expect(
      fs.readFileSync(path.join(serverDir, "index.mjs"), "utf8"),
    ).toContain("t??=Ei();");
  });
});

describe("Cloudflare module preset stubs", () => {
  it("intercepts only the edge-incompatible package roots", async () => {
    const plugin = createCloudflareModuleStubPlugin();
    const sentryStub = plugin.resolveId("@sentry/node");

    expect(CLOUDFLARE_MODULE_STUB_MODULES).toContain("@sentry/node");
    expect(sentryStub).toMatch(/^\0agent-native-cloudflare-module-stub:/);
    expect(plugin.load(sentryStub as string)).toContain("captureException");
    expect(plugin.resolveId("@sentry/node/internals")).toBeNull();
    expect(plugin.resolveId("@anthropic-ai/sdk")).toBeNull();
  });
});

describe("cloudflareWorkerStubAliasArgs", () => {
  it("routes known package subpaths to exact stubs before package aliases", () => {
    const stubDir = path.join("tmp", "worker-stubs");
    const aliases = cloudflareWorkerStubAliasArgs(stubDir);
    const workerAlias = aliases.find((alias) =>
      alias.startsWith("--alias:pdf-parse/worker="),
    );
    const packageAlias = aliases.find((alias) =>
      alias.startsWith("--alias:pdf-parse="),
    );
    const playwrightAlias = aliases.find((alias) =>
      alias.startsWith("--alias:playwright="),
    );

    expect(CLOUDFLARE_WORKER_STUB_SUBPATH_MODULES).toHaveProperty(
      "pdf-parse/worker",
    );
    expect(workerAlias).toBe(
      `--alias:pdf-parse/worker=${path.join(stubDir, "pdf-parse__worker.js")}`,
    );
    expect(packageAlias).toBe(
      `--alias:pdf-parse=${path.join(stubDir, "pdf-parse", "index.js")}`,
    );
    expect(CLOUDFLARE_WORKER_STUB_MODULES).toHaveProperty("playwright");
    expect(playwrightAlias).toBe(
      `--alias:playwright=${path.join(stubDir, "playwright", "index.js")}`,
    );
    expect(aliases.indexOf(workerAlias!)).toBeLessThan(
      aliases.indexOf(packageAlias!),
    );
  });

  it("rejects dynamic imports that bypass fail-closed package stubs", () => {
    expect(() =>
      assertNoCloudflareWorkerStubDynamicImports(
        'const moduleName = "playwright"; import("playwright");',
        "worker.js",
      ),
    ).toThrow(/stubbed module "playwright"/);
    expect(() =>
      assertNoCloudflareWorkerStubDynamicImports(
        "throw new Error('playwright unavailable in Cloudflare Pages worker')",
        "worker.js",
      ),
    ).not.toThrow();
  });
});

describe("resolveNitroBundledYjsEntry", () => {
  it("resolves the complete core-owned ESM export surface", () => {
    const entry = resolveNitroBundledYjsEntry();
    expect(entry).toMatch(/[/\\]yjs[/\\]dist[/\\]yjs\.mjs$/);
    expect(fs.readFileSync(entry, "utf-8")).toMatch(
      /YText as Text[\s\S]*UndoManager[\s\S]*YXmlElement as XmlElement/,
    );
  });
});

function expectDefaultWorkerSsrCacheHeaders(response: Response) {
  for (const [name, value] of Object.entries(DEFAULT_SSR_CACHE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

async function importGeneratedWorker(entrySource: string) {
  const dir = makeTempDir();
  const nodeModules = path.join(dir, "node_modules", "react-router");
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(
    path.join(nodeModules, "package.json"),
    JSON.stringify({ type: "module", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(nodeModules, "index.js"),
    `
export function createRequestHandler() {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(".data")) {
      if (url.pathname === "/custom.data") {
        return new Response('{"ok":true}', {
          headers: {
            "cache-control": "no-cache",
            "content-type": "application/json",
          },
        });
      }
      return new Response('["data"]', {
        headers: {
          "cache-control": url.pathname === "/private.data" ? "private, no-store" : "no-cache",
          "content-type": "text/x-script",
          "x-remix-response": "yes",
        },
      });
    }
    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "/login", "content-type": "text/html" },
      });
    }
    if (url.pathname === "/private-html") {
      return new Response("<html></html>", {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "viewer=private; Path=/",
          "vary": "Cookie, Accept-Encoding, Authorization",
        },
      });
    }
    if (url.pathname === "/request-headers") {
      return new Response(
        '<html><body>' + (request.headers.get("cookie") || "no-cookie") + ':' + (request.headers.get("authorization") || "no-auth") + '</body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    return new Response(
      '<html><head></head><body><a href="/next">next</a><form action="/api/search"></form><style>.hero{background:url("/hero.png")}</style>' +
        request.method + ' ' + url.pathname + '</body></html>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
}
`,
  );
  fs.writeFileSync(path.join(dir, "server-build.js"), "export default {};\n");
  const entryPath = path.join(dir, "entry.mjs");
  fs.writeFileSync(entryPath, entrySource);
  return (await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`))
    .default;
}

// These tests dynamically import generated workers. Under the full workspace
// prep run, module startup shares CPU with many package suites and can exceed
// Vitest's generic 5s default even though the worker responds correctly. Keep
// a bounded suite-local allowance so local prep tests behavior, not scheduler
// contention; focused runs normally complete well below this limit.
describe("generateWorkerEntry", { timeout: 15_000 }, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pins generated React Router SSR to an anonymous request context", () => {
    const source = generateWorkerEntry([], []);

    expect(source).toContain(
      'import { runWithRequestContext } from "@agent-native/core/server/edge";',
    );
    expect(source).toContain(
      "const anonymousContext = { userEmail: undefined, orgId: undefined };",
    );
    expect(source).toContain(
      "runWithRequestContext(anonymousContext, () => rrHandler(request))",
    );
  });

  it("pre-marks generated plugin slots before running async plugins", () => {
    const dir = makeTempDir();
    const agentChatPlugin = path.join(
      dir,
      "server",
      "plugins",
      "agent-chat.ts",
    );
    const coreRoutesPlugin = path.join(
      dir,
      "server",
      "plugins",
      "core-routes.ts",
    );
    const source = generateWorkerEntry(
      [],
      [agentChatPlugin, coreRoutesPlugin],
      ["resources"],
    );

    expect(source).toContain(
      'import { markDefaultPluginProvided as markGeneratedPluginProvided } from "@agent-native/core/server/edge";',
    );
    expect(source).toContain(
      'markGeneratedPluginProvided(nitroApp, "core-routes");',
    );
    expect(source).toContain(
      'markGeneratedPluginProvided(nitroApp, "terminal");',
    );
    expect(
      source.indexOf('markGeneratedPluginProvided(nitroApp, "agent-chat");'),
    ).toBeLessThan(source.indexOf("await plugin_0(nitroApp);"));
  });

  it("pre-marks slots before generated default plugin calls", () => {
    const source = generateWorkerEntry([], [], ["core-routes"]);

    expect(source).toContain(
      'import { defaultCoreRoutesPlugin as defaultPlugin_0 } from "@agent-native/core/server/edge";',
    );
    expect(source).toContain(
      'markGeneratedPluginProvided(nitroApp, "core-routes");',
    );
    expect(
      source.indexOf('markGeneratedPluginProvided(nitroApp, "core-routes");'),
    ).toBeLessThan(source.indexOf("await defaultPlugin_0(nitroApp);"));
  });

  it("strips mounted /api prefixes and removes bodies for HEAD on GET API routes", async () => {
    const dir = makeTempDir();
    const routePath = path.join(dir, "hello.get.mjs");
    fs.writeFileSync(
      routePath,
      `
export default (event) =>
  new Response("body:" + event.req.method + ":" + new URL(event.req.url).pathname, {
    headers: {
      "content-type": "text/plain",
      "x-route-method": event.req.method,
      "x-route-path": new URL(event.req.url).pathname,
    },
  });
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [
          {
            method: "get",
            route: "/api/hello",
            filePath: "api/hello.get.ts",
            absPath: routePath,
          },
        ],
        [],
      ),
    );

    const getResponse = await worker.fetch(
      new Request("https://app.test/docs/api/hello", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(await getResponse.text()).toBe("body:GET:/api/hello");
    expect(getResponse.headers.get("x-route-path")).toBe("/api/hello");

    const headResponse = await worker.fetch(
      new Request("https://app.test/docs/api/hello", { method: "HEAD" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("x-route-method")).toBe("GET");
    await expect(headResponse.text()).resolves.toBe("");
  });

  it("handles mounted /api index routes", async () => {
    const dir = makeTempDir();
    const routePath = path.join(dir, "index.get.mjs");
    fs.writeFileSync(
      routePath,
      `
export default (event) =>
  new Response(new URL(event.req.url).pathname, {
    headers: { "content-type": "text/plain" },
  });
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [
          {
            method: "get",
            route: "/api",
            filePath: "api/index.get.ts",
            absPath: routePath,
          },
        ],
        [],
      ),
    );

    const response = await worker.fetch(
      new Request("https://app.test/docs/api?ping=1"),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    await expect(response.text()).resolves.toBe("/api");
  });

  it("strips mounted SSR paths and rewrites root-relative HTML and redirects", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    const html = await response.text();
    expect(html).toContain("GET /inbox");
    expect(html).toContain('href="/docs/next"');
    expect(html).toContain('action="/docs/api/search"');
    expect(html).toContain('url("/docs/hero.png")');
    expect(html).toContain(
      `<meta property="og:image" content="https://app.test/docs${AGENT_NATIVE_SOCIAL_IMAGE_PATH}?v=${AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER}">`,
    );
    expectDefaultWorkerSsrCacheHeaders(response);
    expect(response.headers.get("speculation-rules")).toBe(
      '"/docs/_agent-native/speculation-rules.json"',
    );

    const redirect = await worker.fetch(
      new Request("https://app.test/docs/redirect", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/docs/login");
  });

  it("hard-caches SSR HTML for authenticated Cloudflare worker requests just like anonymous ones", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    // An auth cookie must make no difference: the framework hard-caches SSR
    // HTML publicly for every visitor.
    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox", {
        method: "GET",
        headers: { cookie: "an_session=1" },
      }),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("overwrites explicit no-store on anonymous Cloudflare worker SSR", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/private-html"),
      {},
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
  });

  it("strips credential headers before generated worker SSR", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/request-headers", {
        headers: {
          cookie: "an_session=active",
          authorization: "Bearer private-token",
        },
      }),
      {},
      {},
    );

    expect(await response.text()).toContain("no-cookie:no-auth");
    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("overwrites route-provided private Cache-Control on authenticated Cloudflare worker SSR HTML responses", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    // Route-level cache hints must not make the shared shell session-dependent
    // or send authenticated page loads back to origin.
    const response = await worker.fetch(
      new Request("https://app.test/private-html", {
        headers: { cookie: "an_session=active" },
      }),
      {},
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("hard-caches React Router data responses with the default no-cache policy", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox.data"),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("hard-caches .data responses for authenticated Cloudflare worker requests", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox.data", {
        headers: { cookie: "an_session=active" },
      }),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("overwrites route-provided private Cache-Control on authenticated Cloudflare worker data responses", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    // React Router page data follows the same public-shell invariant as HTML.
    const response = await worker.fetch(
      new Request("https://app.test/private.data", {
        headers: { cookie: "an_session=active" },
      }),
      {},
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("does not replace no-cache on non-React Router Cloudflare worker data responses", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/custom.data"),
      {},
      {},
    );

    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    expect(response.headers.get("netlify-cdn-cache-control")).toBeNull();
  });

  it("keeps public SSR cache headers for anonymous Cloudflare worker preference cookies", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox", {
        method: "GET",
        headers: { cookie: "sidebar:state=collapsed" },
      }),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    expectDefaultWorkerSsrCacheHeaders(response);
  });

  it("inlines the default SSR cache policy when AGENT_NATIVE_SSR_CACHE is unset", () => {
    vi.stubEnv("AGENT_NATIVE_SSR_CACHE", undefined);

    const source = generateWorkerEntry([], []);

    expect(source).toContain(
      `const SSR_CACHE_HEADERS = ${JSON.stringify(DEFAULT_SSR_CACHE_HEADERS)};`,
    );
  });

  it("inlines the Netlify SSR cache-key policy in generated workers", async () => {
    vi.stubEnv("NETLIFY", "true");

    const source = generateWorkerEntry([], []);
    expect(source).toContain(
      'const SSR_CACHE_KEY_HEADERS = {"netlify-vary":"query=_routes|index"};',
    );

    const worker = await importGeneratedWorker(source);
    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox?utm_source=campaign"),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    expect(response.headers.get("netlify-vary")).toBe("query=_routes|index");
  });

  it("inlines the disabled SSR cache policy when AGENT_NATIVE_SSR_CACHE is off", async () => {
    vi.stubEnv("AGENT_NATIVE_SSR_CACHE", "off");

    const source = generateWorkerEntry([], []);
    expect(source).toContain(
      `const SSR_CACHE_HEADERS = ${JSON.stringify(DISABLED_SSR_CACHE_HEADERS)};`,
    );
    expect(source).not.toContain(DEFAULT_SSR_CACHE_HEADERS["cache-control"]);

    const worker = await importGeneratedWorker(source);
    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox"),
      { APP_BASE_PATH: "/docs" },
      {},
    );

    for (const [name, value] of Object.entries(DISABLED_SSR_CACHE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("caps SSR freshness when AGENT_NATIVE_SSR_CACHE names a duration", async () => {
    vi.stubEnv("AGENT_NATIVE_SSR_CACHE", "30s");

    const source = generateWorkerEntry([], []);
    const expectedHeaders = ssrCacheHeadersForPolicy({
      kind: "maxAge",
      seconds: 30,
    });

    expect(source).toContain(
      `const SSR_CACHE_HEADERS = ${JSON.stringify(expectedHeaders)};`,
    );

    const worker = await importGeneratedWorker(source);
    const response = await worker.fetch(
      new Request("https://app.test/docs/inbox"),
      {},
      {},
    );
    for (const [name, value] of Object.entries(expectedHeaders)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("adds immutable cache headers to Cloudflare Pages hashed assets only", async () => {
    const worker = await importGeneratedWorker(
      generateWorkerEntry([], [], [], [], null, [
        "/assets/entry.client-aB12_cdE.js",
      ]),
    );
    const env = {
      APP_BASE_PATH: "/docs",
      ASSETS: {
        fetch: async () =>
          new Response("asset", {
            headers: { "content-type": "application/javascript" },
          }),
      },
    };

    const hashed = await worker.fetch(
      new Request("https://app.test/docs/assets/entry.client-aB12_cdE.js"),
      env,
      {},
    );
    expect(await hashed.text()).toBe("asset");
    expect(hashed.headers.get("cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
    expect(hashed.headers.get("cdn-cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
    expect(hashed.headers.get("netlify-cdn-cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );

    const unhashed = await worker.fetch(
      new Request("https://app.test/docs/assets/logo.png"),
      env,
      {},
    );
    expect(await unhashed.text()).toBe("asset");
    expect(unhashed.headers.get("cache-control")).toBeNull();
    expect(unhashed.headers.get("cdn-cache-control")).toBeNull();
    expect(unhashed.headers.get("netlify-cdn-cache-control")).toBeNull();

    const manuallyVersioned = await worker.fetch(
      new Request("https://app.test/docs/assets/logo-20240501.png"),
      env,
      {},
    );
    expect(await manuallyVersioned.text()).toBe("asset");
    expect(manuallyVersioned.headers.get("cache-control")).toBeNull();
    expect(manuallyVersioned.headers.get("cdn-cache-control")).toBeNull();
    expect(
      manuallyVersioned.headers.get("netlify-cdn-cache-control"),
    ).toBeNull();
  });

  it("uses the build-time app base path for mounted Cloudflare Pages hashed assets", async () => {
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [],
        [],
        [],
        [],
        null,
        ["/assets/entry.client-aB12_cdE.js"],
        "/docs",
      ),
    );

    const response = await worker.fetch(
      new Request("https://app.test/docs/assets/entry.client-aB12_cdE.js"),
      {
        ASSETS: {
          fetch: async () =>
            new Response("asset", {
              headers: { "content-type": "application/javascript" },
            }),
        },
      },
      {},
    );

    expect(await response.text()).toBe("asset");
    expect(response.headers.get("cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
    expect(response.headers.get("cdn-cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
    expect(response.headers.get("netlify-cdn-cache-control")).toBe(
      IMMUTABLE_ASSET_CACHE_CONTROL,
    );
  });

  it("serves a static app shell without bundling React Router SSR", async () => {
    const source = generateWorkerEntry([], [], [], [], null, [], "", {
      includeReactRouterSsr: false,
    });
    expect(source).not.toContain("react-router");
    expect(source).not.toContain("server-build");
    expect(source).toContain("fetchStaticAppShell");

    const worker = await importGeneratedWorker(source);
    const requestedPaths: string[] = [];
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          requestedPaths.push(new URL(request.url).pathname);
          if (new URL(request.url).pathname === "/index.html") {
            return new Response(
              "<html><head></head><body>shell</body></html>",
              {
                headers: { "content-type": "text/html; charset=utf-8" },
              },
            );
          }
          return new Response("missing", { status: 404 });
        },
      },
    };

    const appRoute = await worker.fetch(
      new Request("https://app.test/ask"),
      env,
      {},
    );
    expect(appRoute.status).toBe(200);
    await expect(appRoute.text()).resolves.toContain("shell");
    expectDefaultWorkerSsrCacheHeaders(appRoute);
    expect(requestedPaths).toEqual(["/ask", "/index.html"]);

    const head = await worker.fetch(
      new Request("https://app.test/ask", { method: "HEAD" }),
      env,
      {},
    );
    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe("");

    const missingApi = await worker.fetch(
      new Request("https://app.test/api/missing"),
      env,
      {},
    );
    expect(missingApi.status).toBe(404);
  });

  it("generates a manifest-based Cloudflare Pages static shell fallback", () => {
    const html = generateCloudflarePagesStaticShellFromManifest(
      {
        entry: {
          module: "/assets/entry.client-abc.js",
          imports: ["/assets/vendor-def.js"],
          css: ["/assets/entry.css"],
        },
        routes: {
          root: {
            id: "root",
            module: "/assets/root-ghi.js",
            imports: ["/assets/root-vendor-jkl.js"],
            css: ["/assets/root.css"],
            clientLoaderModule: "/assets/root-client-loader-mno.js",
          },
        },
        url: "/assets/manifest-123.js",
      },
      "/docs",
    );

    expect(html).toContain("window.__reactRouterContext");
    expect(html).toContain('"basename":"/docs"');
    expect(html).toContain('"isSpaMode":true');
    expect(html).toContain('import "/assets/manifest-123.js"');
    expect(html).toContain('import * as route0 from "/assets/root-ghi.js"');
    expect(html).toContain(
      'import * as route0_clientLoader from "/assets/root-client-loader-mno.js"',
    );
    expect(html).toContain('import("/assets/entry.client-abc.js")');
    expect(html).toContain('href="/assets/root.css"');
    expect(html).toContain("streamController.enqueue");
    expect(html).not.toContain("dev server");
    expect(html).not.toContain("browser console");
    expect(html).toContain("loaderData");
    expect(html).not.toContain("en-US");
  });

  it("hydrates default root loader data in the manifest fallback", () => {
    const html = generateCloudflarePagesStaticShellFromManifest({
      entry: {
        module: "/assets/entry.client-abc.js",
      },
      routes: {
        root: {
          id: "root",
          module: "/assets/root-ghi.js",
          hasLoader: true,
        },
      },
      url: "/assets/manifest-123.js",
    });

    expect(html).toContain("loaderData");
    expect(html).toContain("root");
    expect(html).toContain("en-US");
    expect(html).toContain("system");
    expect(html).toContain("messages");
  });

  it("injects runtime browser Sentry config into generated worker SSR HTML", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/inbox", { method: "GET" }),
      { SENTRY_DSN: "https://public@example/4511270423822336" },
      {},
    );
    const html = await response.text();

    expect(html).toContain("data-agent-native-sentry-config");
    expect(html).toContain("https://public@example/4511270423822336");
  });

  it("keeps mounted SSR HEAD responses bodyless and leaves missing API paths as 404", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const head = await worker.fetch(
      new Request("https://app.test/docs/inbox", { method: "HEAD" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe("");

    const missingApi = await worker.fetch(
      new Request("https://app.test/docs/api/missing", { method: "GET" }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(missingApi.status).toBe(404);
  });

  it("strips mounted base path for auto-mounted action routes under /_agent-native/actions/", async () => {
    const dir = makeTempDir();
    const actionPath = path.join(dir, "ping-action.mjs");
    fs.writeFileSync(
      actionPath,
      `
export default {
  run: async (params) => ({ ok: true, echo: params }),
};
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [],
        [],
        [],
        [{ name: "ping", absPath: actionPath, method: "post" }],
      ),
    );

    // With APP_BASE_PATH=/docs the client calls /docs/_agent-native/actions/ping.
    // Without the fix the request arrives at H3 with the prefix still attached,
    // misses the literal `/_agent-native/actions/ping` registration, and 404s.
    const mountedResponse = await worker.fetch(
      new Request("https://app.test/docs/_agent-native/actions/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      { APP_BASE_PATH: "/docs" },
      {},
    );
    expect(mountedResponse.status).toBe(200);
    await expect(mountedResponse.json()).resolves.toEqual({
      ok: true,
      echo: { hello: "world" },
    });

    // No base path — original behavior still works.
    const unmountedResponse = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "again" }),
      }),
      {},
      {},
    );
    expect(unmountedResponse.status).toBe(200);
    await expect(unmountedResponse.json()).resolves.toEqual({
      ok: true,
      echo: { hello: "again" },
    });
  });

  it("accepts frontend mutation RPCs without widening direct HTTP action methods", async () => {
    const dir = makeTempDir();
    const actionPath = path.join(dir, "delete-action.mjs");
    fs.writeFileSync(
      actionPath,
      `
export default {
  run: async (params, context) => ({
    ok: true,
    echo: params,
    caller: context?.caller,
  }),
};
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [],
        [],
        [],
        [{ name: "delete-item", absPath: actionPath, method: "delete" }],
      ),
    );

    const frontendPost = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/delete-item", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-native-frontend": "1",
        },
        body: JSON.stringify({ id: "item-1" }),
      }),
      {},
      {},
    );
    expect(frontendPost.status).toBe(200);
    await expect(frontendPost.json()).resolves.toEqual({
      ok: true,
      echo: { id: "item-1" },
      caller: "frontend",
    });

    const directPost = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/delete-item", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "item-2" }),
      }),
      {},
      {},
    );
    expect(directPost.status).toBe(405);
    await expect(directPost.json()).resolves.toEqual({
      error: "Method not allowed. Use DELETE.",
    });

    const directDelete = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/delete-item", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "item-3" }),
      }),
      {},
      {},
    );
    expect(directDelete.status).toBe(200);
    await expect(directDelete.json()).resolves.toEqual({
      ok: true,
      echo: { id: "item-3" },
      caller: "http",
    });

    const strictSource = generateWorkerEntry(
      [],
      [],
      [],
      [{ name: "head-item", absPath: actionPath, method: "head" }],
    );
    expect(strictSource).not.toContain(
      'app.on("POST", "/_agent-native/actions/head-item"',
    );
  });

  it("allows browser action-client headers in generated worker preflight responses", async () => {
    const worker = await importGeneratedWorker(generateWorkerEntry([], []));

    const response = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/ping", {
        method: "OPTIONS",
      }),
      {},
      {},
    );

    expect(response.status).toBe(204);
    const allowHeaders = response.headers.get("Access-Control-Allow-Headers");
    expect(allowHeaders).toContain("X-Agent-Native-Frontend");
    expect(allowHeaders).toContain("X-Agent-Native-Client-Compatibility");
    expect(allowHeaders).toContain("X-Agent-Native-Build-Id");
    expect(allowHeaders).toContain("X-User-Timezone");
  });

  it("mounts an action under its custom http.path, not its name", async () => {
    const dir = makeTempDir();
    const actionPath = path.join(dir, "aliased-action.mjs");
    fs.writeFileSync(
      actionPath,
      `
export default {
  run: async (params) => ({ ok: true, echo: params }),
};
`,
    );
    const worker = await importGeneratedWorker(
      generateWorkerEntry(
        [],
        [],
        [],
        // Mirrors the runtime mount: route = `${PREFIX}/${http.path ?? name}`.
        [{ name: "aliased", absPath: actionPath, method: "post", path: "v2" }],
      ),
    );

    const aliased = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/v2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      {},
      {},
    );
    expect(aliased.status).toBe(200);
    await expect(aliased.json()).resolves.toEqual({
      ok: true,
      echo: { hello: "world" },
    });

    // The bare name is no longer a route when a custom path is set.
    const byName = await worker.fetch(
      new Request("https://app.test/_agent-native/actions/aliased", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      {},
      {},
    );
    expect(byName.status).toBe(404);
  });
});

describe("CLOUDFLARE_WORKER_ESBUILD_EXTERNALS", () => {
  it("externalizes browser screenshot packages with native dependencies", () => {
    expect(CLOUDFLARE_WORKER_ESBUILD_EXTERNALS).toContain("playwright-core");
    expect(CLOUDFLARE_WORKER_ESBUILD_EXTERNALS).toContain("chromium-bidi/*");
    expect(CLOUDFLARE_WORKER_ESBUILD_EXTERNALS).toContain(
      "@sparticuz/chromium-min",
    );
    expect(CLOUDFLARE_WORKER_ESBUILD_EXTERNALS).toContain("fsevents");
  });

  it("stubs edge-incompatible optional packages before externalizing", () => {
    expect(CLOUDFLARE_WORKER_STUB_MODULES["@sentry/node"]).toContain("init");
    expect(CLOUDFLARE_WORKER_STUB_MODULES["@resvg/resvg-js"]).toContain(
      "Resvg",
    );
    expect(CLOUDFLARE_WORKER_STUB_MODULES["playwright-core"]).toContain(
      "chromium",
    );
  });

  it("stubs node builtins that Cloudflare Pages rejects at upload time", () => {
    expect(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES.child_process).toContain(
      "execFileSync",
    );
    expect(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES.fs).toContain(
      "existsSync",
    );
    expect(
      CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES["fs/promises"],
    ).toContain("mkdtemp");
    expect(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES.console).toContain(
      "globalThis.console",
    );
    expect(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES.net).toContain("isIP");
    expect(CLOUDFLARE_WORKER_NODE_BUILTIN_STUB_MODULES.module).toContain(
      "createRequire",
    );
  });
});

describe("Nitro runtime scan ignores", () => {
  it("excludes test files from Nitro route, middleware, and plugin scanning", () => {
    expect(NITRO_RUNTIME_IGNORE_PATTERNS).toEqual(
      expect.arrayContaining([
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.spec.mjs",
        "**/*.test.cjs",
      ]),
    );
  });
});

describe("generateProvidedPluginsNitroPluginSource", () => {
  it("emits a Nitro plugin that pre-marks discovered app plugin slots", () => {
    const source = generateProvidedPluginsNitroPluginSource([
      "core-routes",
      "agent-chat",
      "core-routes",
    ]);

    expect(source).toContain(
      'import { markDefaultPluginProvided } from "@agent-native/core/server/edge";',
    );
    expect(source).toContain(
      'const pluginStems = ["agent-chat","core-routes"]',
    );
    expect(source).toContain("markDefaultPluginProvided(nitroApp, stem);");
  });
});

describe("Cloudflare deploy builtins", () => {
  it("externalizes node:sqlite references from optional runtime probes", () => {
    expect(getNodeBuiltinNames()).toContain("sqlite");
  });
});

describe("copyDir", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("copies directory symlink targets instead of treating symlinks as files", () => {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-copy-dir-test-"));
    dirs.push(cwd);
    const src = path.join(cwd, "src");
    const dest = path.join(cwd, "dest");
    const linkedTarget = path.join(cwd, "linked-target");
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(linkedTarget, { recursive: true });
    fs.writeFileSync(path.join(linkedTarget, "asset.txt"), "asset");
    fs.symlinkSync(
      linkedTarget,
      path.join(src, "linked-dir"),
      process.platform === "win32" ? "junction" : "dir",
    );

    copyDir(src, dest);

    expect(
      fs.readFileSync(path.join(dest, "linked-dir", "asset.txt"), "utf8"),
    ).toBe("asset");
  });

  it("skips broken symlinks instead of crashing the copy", () => {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-copy-dir-test-"));
    dirs.push(cwd);
    const src = path.join(cwd, "src");
    const dest = path.join(cwd, "dest");
    fs.mkdirSync(src, { recursive: true });
    fs.symlinkSync(path.join(cwd, "missing-target"), path.join(src, "broken"));

    expect(() => copyDir(src, dest)).not.toThrow();
    expect(fs.existsSync(path.join(dest, "broken"))).toBe(false);
  });
});

describe("findInstalledFfmpegStaticPackage", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupNodeModules() {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-ffmpeg-test-"));
    dirs.push(cwd);
    const nodeModules = path.join(cwd, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    return nodeModules;
  }

  it("finds a direct ffmpeg-static install only when the binary exists", () => {
    const nodeModules = setupNodeModules();
    const packageDir = path.join(nodeModules, "ffmpeg-static");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");

    expect(findInstalledFfmpegStaticPackage([nodeModules])).toBeNull();

    fs.writeFileSync(path.join(packageDir, "ffmpeg"), "binary");

    expect(findInstalledFfmpegStaticPackage([nodeModules])).toBe(packageDir);
  });

  it("finds ffmpeg-static in pnpm's nested store layout", () => {
    const nodeModules = setupNodeModules();
    const packageDir = path.join(
      nodeModules,
      ".pnpm",
      "ffmpeg-static@5.3.0",
      "node_modules",
      "ffmpeg-static",
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.writeFileSync(path.join(packageDir, "ffmpeg"), "binary");

    expect(findInstalledFfmpegStaticPackage([nodeModules])).toBe(packageDir);
  });

  it("only bundles host ffmpeg-static binaries for matching Linux serverless targets", () => {
    expect(shouldBundleFfmpegStaticForServerless("linux", "x64", "x64")).toBe(
      true,
    );
    expect(
      shouldBundleFfmpegStaticForServerless("linux", "arm64", "arm64"),
    ).toBe(true);
    expect(shouldBundleFfmpegStaticForServerless("linux", "x64", "arm64")).toBe(
      false,
    );
    expect(shouldBundleFfmpegStaticForServerless("linux", "x64", null)).toBe(
      false,
    );
    expect(shouldBundleFfmpegStaticForServerless("darwin", "x64", "x64")).toBe(
      false,
    );
    expect(shouldBundleFfmpegStaticForServerless("win32", "x64", "x64")).toBe(
      false,
    );
  });
});

describe("copyInstalledBrowserRuntimePackages", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const directory of dirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function setupBrowserRuntimeStore(appDependencies: Record<string, string>) {
    const root = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-browser-runtime-test-"),
    );
    dirs.push(root);
    const nodeModules = path.join(root, "node_modules");
    const chromiumDir = path.join(
      nodeModules,
      ".pnpm",
      "@sparticuz+chromium@149.0.0",
      "node_modules",
      "@sparticuz",
      "chromium",
    );
    const chromiumDependenciesDir = path.join(
      nodeModules,
      ".pnpm",
      "@sparticuz+chromium@149.0.0",
      "node_modules",
    );
    const tarFsDir = path.join(chromiumDependenciesDir, "tar-fs");
    const playwrightCoreDir = path.join(
      nodeModules,
      ".pnpm",
      "playwright-core@1.61.1",
      "node_modules",
      "playwright-core",
    );
    fs.mkdirSync(path.join(chromiumDir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(chromiumDir, "build"), { recursive: true });
    fs.mkdirSync(tarFsDir, { recursive: true });
    fs.mkdirSync(playwrightCoreDir, { recursive: true });
    fs.writeFileSync(
      path.join(chromiumDir, "package.json"),
      JSON.stringify({
        name: "@sparticuz/chromium",
        dependencies: { "tar-fs": "3.1.3" },
        main: "build/index.js",
      }),
    );
    fs.writeFileSync(path.join(chromiumDir, "bin", "chromium.br"), "binary");
    fs.writeFileSync(path.join(chromiumDir, "build", "index.js"), "export {};");
    fs.writeFileSync(
      path.join(tarFsDir, "package.json"),
      JSON.stringify({ name: "tar-fs", main: "index.js" }),
    );
    fs.writeFileSync(path.join(tarFsDir, "index.js"), "export {};");
    fs.writeFileSync(
      path.join(playwrightCoreDir, "package.json"),
      JSON.stringify({ name: "playwright-core", main: "index.js" }),
    );
    fs.writeFileSync(path.join(playwrightCoreDir, "index.js"), "export {};");
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-app", dependencies: appDependencies }),
    );

    const serverDir = path.join(root, "server");
    fs.mkdirSync(serverDir, { recursive: true });
    return { root, nodeModules, chromiumDir, serverDir };
  }

  it("copies Chromium assets and its runtime dependencies from pnpm output", () => {
    const { root, nodeModules, chromiumDir, serverDir } =
      setupBrowserRuntimeStore({
        "@agent-native/creative-context": "workspace:*",
      });

    expect(findInstalledPackageRoot("@sparticuz/chromium", [nodeModules])).toBe(
      chromiumDir,
    );
    expect(copyInstalledBrowserRuntimePackages(serverDir, root)).toBe(3);
    expect(
      fs.existsSync(
        path.join(
          serverDir,
          "node_modules",
          "@sparticuz",
          "chromium",
          "bin",
          "chromium.br",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(serverDir, "node_modules", "tar-fs"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(serverDir, "node_modules", "playwright-core")),
    ).toBe(true);
  });

  it("skips the browser runtime for an app that cannot reach it", () => {
    // The store still resolves Chromium through a sibling workspace package —
    // that resolution is exactly what used to ship 80MB into every function.
    const { root, nodeModules, chromiumDir, serverDir } =
      setupBrowserRuntimeStore({ "some-unrelated-package": "1.0.0" });

    expect(findInstalledPackageRoot("@sparticuz/chromium", [nodeModules])).toBe(
      chromiumDir,
    );
    expect(findServerlessBrowserRuntimeConsumer(root)).toBeNull();
    expect(copyInstalledBrowserRuntimePackages(serverDir, root)).toBe(0);
    expect(fs.existsSync(path.join(serverDir, "node_modules"))).toBe(false);
  });

  it("copies the browser runtime for an app that declares a browser package directly", () => {
    const { root, serverDir } = setupBrowserRuntimeStore({
      "playwright-core": "1.61.1",
    });

    expect(findServerlessBrowserRuntimeConsumer(root)).toBe("playwright-core");
    expect(copyInstalledBrowserRuntimePackages(serverDir, root)).toBe(3);
  });
});

describe("pruneServerlessFunctionDeadWeight", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const directory of dirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function writePackage(dir: string, bytes = 16) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.node"), "x".repeat(bytes));
  }

  function setupFunctionDir(): string {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-prune-test-"));
    dirs.push(root);
    const functionDir = path.join(root, "server");
    const nodeModules = path.join(functionDir, "node_modules");
    for (const name of [
      "darwin-arm64",
      "darwin-x64",
      "win32-x64-msvc",
      "linux-arm-gnueabihf",
      "linux-arm-musleabihf",
      "linux-x64-gnu",
      "linux-arm64-musl",
    ]) {
      writePackage(path.join(nodeModules, "@libsql", name));
    }
    // sharp names its prebuilds without the gnu/musl suffix, so every one of
    // them reads as dead to isServerlessNativePlatformPackage.
    for (const name of ["sharp-linux-x64", "sharp-darwin-arm64"]) {
      writePackage(path.join(nodeModules, "@img", name));
    }
    writePackage(path.join(nodeModules, "tar-fs"));
    fs.mkdirSync(path.join(functionDir, "data"), { recursive: true });
    fs.writeFileSync(path.join(functionDir, "data", "app.db"), "sqlite");
    return functionDir;
  }

  it("drops prebuilds a serverless function cannot execute and the local dev database", () => {
    const functionDir = setupFunctionDir();
    const libsql = path.join(functionDir, "node_modules", "@libsql");

    expect(pruneServerlessFunctionDeadWeight(functionDir)).toBeGreaterThan(0);

    expect(fs.readdirSync(libsql).sort()).toEqual([
      "linux-arm64-musl",
      "linux-x64-gnu",
    ]);
    expect(fs.existsSync(path.join(functionDir, "data"))).toBe(false);
    expect(
      fs.existsSync(path.join(functionDir, "node_modules", "tar-fs")),
    ).toBe(true);
  });

  it("leaves packages whose prebuilds it cannot classify alone", () => {
    const functionDir = setupFunctionDir();

    pruneServerlessFunctionDeadWeight(functionDir);

    expect(
      fs.readdirSync(path.join(functionDir, "node_modules", "@img")).sort(),
    ).toEqual(["sharp-darwin-arm64", "sharp-linux-x64"]);
  });
});

describe("sanitizeServerlessFunctionPackageManifest", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupFunctionDir() {
    const root = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-function-manifest-"),
    );
    dirs.push(root);
    const functionDir = path.join(root, "server");
    fs.mkdirSync(path.join(functionDir, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(functionDir, "package.json"),
      JSON.stringify(
        {
          name: "traced-node-modules",
          type: "module",
          dependencies: {
            "@libsql/linux-x64-gnu": "0.5.29",
            electron: "41.9.0",
            "node-pty": "1.1.0",
            "playwright-core": "1.61.1",
          },
          optionalDependencies: {
            fsevents: "2.3.2",
          },
        },
        null,
        2,
      ),
    );

    for (const packageName of ["electron", "node-pty", "playwright-core"]) {
      fs.mkdirSync(path.join(functionDir, "node_modules", packageName), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(functionDir, "node_modules", packageName, "package.json"),
        "{}",
      );
    }

    return functionDir;
  }

  it("removes desktop-only packages but keeps serverless runtime packages", () => {
    const functionDir = setupFunctionDir();

    sanitizeServerlessFunctionPackageManifest(functionDir);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(functionDir, "package.json"), "utf8"),
    );
    expect(packageJson.dependencies).toEqual({
      "@libsql/linux-x64-gnu": "0.5.29",
      "playwright-core": "1.61.1",
    });
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(
      fs.existsSync(path.join(functionDir, "node_modules", "electron")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(functionDir, "node_modules", "node-pty")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(functionDir, "node_modules", "playwright-core")),
    ).toBe(true);
  });
});

describe("isServerlessNativePlatformPackage", () => {
  it("keeps only the 64-bit Linux prebuilds a serverless function can run", () => {
    const kept = [
      "linux-x64-gnu",
      "linux-x64-musl",
      "linux-arm64-gnu",
      "linux-arm64-musl",
      "resvg-js-linux-x64-gnu",
      "resvg-js-linux-arm64-musl",
    ];
    const dropped = [
      "darwin-arm64",
      "darwin-x64",
      "win32-x64-msvc",
      "linux-arm-gnueabihf",
      "linux-arm-musleabihf",
      "resvg-js-darwin-x64",
      "resvg-js-win32-ia32-msvc",
      "resvg-js-android-arm64",
      "resvg-js-linux-arm-gnueabihf",
    ];

    for (const name of kept) {
      expect(isServerlessNativePlatformPackage(name)).toBe(true);
    }
    for (const name of dropped) {
      expect(isServerlessNativePlatformPackage(name)).toBe(false);
    }
  });

  it("does not classify the resvg JS wrapper as a platform prebuild", () => {
    expect(isServerlessNativePlatformPackage("resvg-js")).toBe(false);
  });
});

describe("findInstalledResvgPackages", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupNodeModules() {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-resvg-test-"));
    dirs.push(cwd);
    const nodeModules = path.join(cwd, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    return nodeModules;
  }

  it("finds direct resvg packages", () => {
    const nodeModules = setupNodeModules();
    const packageDir = path.join(nodeModules, "@resvg", "resvg-js");
    const nativeDir = path.join(
      nodeModules,
      "@resvg",
      "resvg-js-linux-x64-gnu",
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.writeFileSync(path.join(nativeDir, "package.json"), "{}");

    expect(findInstalledResvgPackages([nodeModules])).toEqual([
      { packageName: "resvg-js", packageDir },
      { packageName: "resvg-js-linux-x64-gnu", packageDir: nativeDir },
    ]);
  });

  it("finds resvg packages in pnpm's nested store layout", () => {
    const nodeModules = setupNodeModules();
    const packageDir = path.join(
      nodeModules,
      ".pnpm",
      "@resvg+resvg-js@2.6.2",
      "node_modules",
      "@resvg",
      "resvg-js",
    );
    const nativeDir = path.join(
      nodeModules,
      ".pnpm",
      "@resvg+resvg-js-linux-x64-gnu@2.6.2",
      "node_modules",
      "@resvg",
      "resvg-js-linux-x64-gnu",
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.writeFileSync(path.join(nativeDir, "package.json"), "{}");

    expect(findInstalledResvgPackages([nodeModules])).toEqual([
      { packageName: "resvg-js", packageDir },
      { packageName: "resvg-js-linux-x64-gnu", packageDir: nativeDir },
    ]);
  });
});

describe("runNitroBuildPipeline", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function setupFixture() {
    const cwd = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-nitro-pipeline-"),
    );
    dirs.push(cwd);

    // Simulate a React Router client build with a hashed asset chunk.
    const clientDir = path.join(cwd, "build", "client");
    fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, "assets", "entry.client-abc.js"),
      "console.log('rr-client')",
    );
    fs.writeFileSync(
      path.join(clientDir, "assets", "entry.client-aB12_cdE.js"),
      "console.log('hashed-client')",
    );
    fs.writeFileSync(path.join(clientDir, "assets", "logo.png"), "png");

    // Simulate the cleared publicDir Nitro would set up in `prepare`.
    const publicOutputDir = path.join(cwd, ".output", "public");
    fs.mkdirSync(publicOutputDir, { recursive: true });

    return { cwd, clientDir, publicOutputDir };
  }

  it("copies the React Router client build into publicDir before nitroBuild scans it", async () => {
    const { cwd, clientDir, publicOutputDir } = setupFixture();

    const calls: string[] = [];
    let routeRuleAtPrepare: unknown;
    let publicDirContentsAtNitroBuild: string[] = [];
    const nitro: any = {
      options: { output: { publicDir: publicOutputDir } },
    };

    await runNitroBuildPipeline({
      nitro,
      hooks: {
        prepare: async () => {
          calls.push("prepare");
          routeRuleAtPrepare =
            nitro.options.routeRules?.["/assets/entry.client-aB12_cdE.js"];
        },
        copyPublicAssets: async () => {
          calls.push("copyPublicAssets");
        },
        nitroBuild: async () => {
          calls.push("nitroBuild");
          // This is where Nitro globs publicDir to bake the static manifest
          // into the server bundle. Record what's visible at this point.
          publicDirContentsAtNitroBuild = fs.readdirSync(
            path.join(publicOutputDir, "assets"),
          );
        },
      },
      clientDir,
      publicOutputDir,
      appBasePath: "",
      cwd,
    });

    expect(calls).toEqual(["prepare", "copyPublicAssets", "nitroBuild"]);
    expect(routeRuleAtPrepare).toMatchObject({
      headers: { "cache-control": IMMUTABLE_ASSET_CACHE_CONTROL },
    });
    // The regression we're guarding against: if the client build is copied
    // *after* nitroBuild, the manifest is empty here and /assets/* 404s at
    // runtime even though the files exist on disk.
    expect(publicDirContentsAtNitroBuild).toContain("entry.client-abc.js");
  });

  it("mirrors client assets under the app base path when configured", async () => {
    const { cwd, clientDir, publicOutputDir } = setupFixture();

    await runNitroBuildPipeline({
      nitro: { options: { output: { publicDir: publicOutputDir } } },
      hooks: {
        prepare: async () => {},
        copyPublicAssets: async () => {},
        nitroBuild: async () => {},
      },
      clientDir,
      publicOutputDir,
      appBasePath: "/docs",
      cwd,
    });

    expect(
      fs.existsSync(
        path.join(publicOutputDir, "assets", "entry.client-abc.js"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(publicOutputDir, "docs", "assets", "entry.client-abc.js"),
      ),
    ).toBe(true);
  });

  it("does not mirror again when the preset already mounted publicDir at the base path", async () => {
    const { cwd, clientDir } = setupFixture();
    // Nitro's netlify preset resolves publicDir to `dist{{ baseURL }}`, so the
    // public dir IS the mount path. Mirroring again wrote a whole second client
    // build at dist/docs/docs that only the workspace deploy ever deleted.
    const publicOutputDir = path.join(cwd, "dist", "docs");
    fs.mkdirSync(publicOutputDir, { recursive: true });

    await runNitroBuildPipeline({
      nitro: { options: { output: { publicDir: publicOutputDir } } },
      hooks: {
        prepare: async () => {},
        copyPublicAssets: async () => {},
        nitroBuild: async () => {},
      },
      clientDir,
      publicOutputDir,
      appBasePath: "/docs",
      cwd,
    });

    expect(
      fs.existsSync(
        path.join(publicOutputDir, "assets", "entry.client-abc.js"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(publicOutputDir, "docs"))).toBe(false);
  });

  it("adds exact immutable route rules for copied hashed client assets", async () => {
    const { cwd, clientDir, publicOutputDir } = setupFixture();
    const nitro: any = {
      options: { output: { publicDir: publicOutputDir } },
    };

    await runNitroBuildPipeline({
      nitro,
      hooks: {
        prepare: async () => {},
        copyPublicAssets: async () => {},
        nitroBuild: async () => {},
      },
      clientDir,
      publicOutputDir,
      appBasePath: "/docs",
      cwd,
    });

    expect(
      nitro.options.routeRules["/assets/entry.client-aB12_cdE.js"].headers[
        "cache-control"
      ],
    ).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(
      nitro.options.routeRules["/docs/assets/entry.client-aB12_cdE.js"].headers[
        "cdn-cache-control"
      ],
    ).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(
      nitro.options.routeRules["/docs/assets/entry.client-aB12_cdE.js"].headers[
        "netlify-cdn-cache-control"
      ],
    ).toBe(IMMUTABLE_ASSET_CACHE_CONTROL);
    expect(nitro.options.routeRules["/assets/logo.png"]).toBeUndefined();
    expect(
      nitro.options.routeRules["/assets/entry.client-abc.js"],
    ).toBeUndefined();
  });

  it("merges immutable headers into existing route rules", () => {
    const routeRules: Record<string, { headers?: Record<string, string> }> = {
      "/assets/entry.client-aB12_cdE.js": {
        headers: { "cross-origin-resource-policy": "cross-origin" },
      },
    };
    const { clientDir } = setupFixture();

    addImmutableAssetRouteRulesForClientBuild(routeRules, clientDir);

    expect(
      routeRules["/assets/entry.client-aB12_cdE.js"].headers,
    ).toMatchObject({
      "cross-origin-resource-policy": "cross-origin",
      "cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
      "cdn-cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
      "netlify-cdn-cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
    });
  });

  it("skips the client copy when the React Router build is absent", async () => {
    const cwd = fs.mkdtempSync(
      path.join(process.cwd(), ".tmp-nitro-pipeline-"),
    );
    dirs.push(cwd);
    const publicOutputDir = path.join(cwd, ".output", "public");
    fs.mkdirSync(publicOutputDir, { recursive: true });

    await expect(
      runNitroBuildPipeline({
        nitro: { options: { output: { publicDir: publicOutputDir } } },
        hooks: {
          prepare: async () => {},
          copyPublicAssets: async () => {},
          nitroBuild: async () => {},
        },
        clientDir: path.join(cwd, "build", "client"),
        publicOutputDir,
        appBasePath: "",
        cwd,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("durable-background Netlify function emit (single-template, default-on)", () => {
  const dirs: string[] = [];
  let previousFlag: string | undefined;
  let previousWorkspaceFlag: string | undefined;
  let previousViteWorkspaceFlag: string | undefined;
  let previousDisableRecurringJobs: string | undefined;
  let previousAppBasePath: string | undefined;
  let previousViteAppBasePath: string | undefined;

  beforeEach(() => {
    previousFlag = process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    previousWorkspaceFlag = process.env.AGENT_NATIVE_WORKSPACE;
    previousViteWorkspaceFlag = process.env.VITE_AGENT_NATIVE_WORKSPACE;
    previousDisableRecurringJobs =
      process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS;
    previousAppBasePath = process.env.APP_BASE_PATH;
    previousViteAppBasePath = process.env.VITE_APP_BASE_PATH;
    delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
    delete process.env.AGENT_NATIVE_WORKSPACE;
    delete process.env.VITE_AGENT_NATIVE_WORKSPACE;
    delete process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS;
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    const restoreEnv = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restoreEnv("AGENT_CHAT_DURABLE_BACKGROUND", previousFlag);
    restoreEnv("AGENT_NATIVE_WORKSPACE", previousWorkspaceFlag);
    restoreEnv("VITE_AGENT_NATIVE_WORKSPACE", previousViteWorkspaceFlag);
    restoreEnv(
      "AGENT_NATIVE_DISABLE_RECURRING_JOBS",
      previousDisableRecurringJobs,
    );
    restoreEnv("APP_BASE_PATH", previousAppBasePath);
    restoreEnv("VITE_APP_BASE_PATH", previousViteAppBasePath);
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  // Reproduce the REAL Nitro v3 `netlify` preset layout the emit reads, grounded
  // in actual build output: .netlify/functions-internal/server/{main.mjs,
  // server.mjs}, where server.mjs declares the in-code `/*` catch-all config with
  // an `excludedPath` array (exactly what generateNetlifyFunction emits).
  const SERVER_ENTRY =
    'export { default } from "./main.mjs";\n' +
    "export const config = {\n" +
    '  name: "server handler",\n' +
    '  generator: "nitro@3.0.0",\n' +
    '  path: "/*",\n' +
    '  nodeBundler: "none",\n' +
    '  includedFiles: ["**"],\n' +
    '  excludedPath: ["/.netlify/*"],\n' +
    "  preferStatic: true,\n" +
    "};\n";

  function setupNetlifyOutput(): string {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-bg-emit-"));
    dirs.push(cwd);
    fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "dist", "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "dist", "assets", "entry.client-abc.js"),
      "export {};\n",
    );
    const serverDir = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
    );
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, "main.mjs"), "export default {};\n");
    fs.writeFileSync(path.join(serverDir, "server.mjs"), SERVER_ENTRY);
    fs.mkdirSync(path.join(serverDir, "_libs"), { recursive: true });
    fs.writeFileSync(path.join(serverDir, "_libs", "yjs.mjs"), "export {};\n");
    return cwd;
  }

  function serverEntryPath(cwd: string): string {
    return path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "server.mjs",
    );
  }

  function backgroundDir(cwd: string): string {
    // Emitted INTO the SCANNED functions-internal dir so Netlify discovers it and
    // honors its `export const config` (the standard functions dir
    // `.netlify/functions/` is the build OUTPUT dir and is never scanned).
    return path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server-agent-background",
    );
  }

  it("keeps integration recovery default-off and recognizes explicit opt-in", () => {
    delete process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
    expect(isIntegrationDurableDispatchDeployEnabled()).toBe(false);
    process.env.AGENT_INTEGRATION_DURABLE_DISPATCH = "true";
    expect(isIntegrationDurableDispatchDeployEnabled()).toBe(true);
    delete process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
  });

  it("emits a bounded one-minute integration recovery function", async () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyIntegrationRecoveryFunction(cwd);

    const dest = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server-integration-recovery",
    );
    expect(fs.existsSync(path.join(dest, "main.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "server.mjs"))).toBe(false);
    const entry = fs.readFileSync(
      path.join(dest, "server-integration-recovery.mjs"),
      "utf8",
    );
    expect(entry).toContain('schedule: "* * * * *"');
    expect(entry).toContain(
      'const SWEEP_PATH = "/_agent-native/integrations/retry-stuck-tasks"',
    );
    expect(entry).toContain(
      "globalThis.__AGENT_NATIVE_INTEGRATION_RECOVERY_RUNTIME__ = true",
    );
    expect(entry).toContain('createHmac("sha256", secret)');
    expect(entry).toContain(
      "if (!enabled()) return new Response(null, { status: 204 })",
    );
    expect(entry).not.toMatch(/^\s*path:/m);
    const generated = await import(
      `${pathToFileURL(path.join(dest, "server-integration-recovery.mjs")).href}?t=${Date.now()}`
    );
    expect(generated.config.schedule).toBe("* * * * *");
    process.env.AGENT_INTEGRATION_DURABLE_DISPATCH = "true";
    delete process.env.A2A_SECRET;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await generated.default(
        new Request("https://app.test/.netlify/functions/recovery"),
        {},
      );
      expect(response.status).toBe(204);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[integration-recovery] A2A_SECRET is required; sweep skipped",
      );
    } finally {
      consoleSpy.mockRestore();
      delete process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
    }
  });

  function keepWarmDir(cwd: string): string {
    return path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "agent-native-keep-warm",
    );
  }

  it("emits a site-local scheduled function that warms the real server route", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyKeepWarmFunction(cwd);

    const entryPath = path.join(keepWarmDir(cwd), "agent-native-keep-warm.mjs");
    expect(fs.existsSync(entryPath)).toBe(true);
    const entry = fs.readFileSync(entryPath, "utf8");
    expect(entry).toContain('const HEALTH_PATH = "/_agent-native/health"');
    expect(entry).toContain('schedule: "* * * * *"');
    expect(entry).toContain('nodeBundler: "none"');
    expect(entry).not.toContain("includedFiles");
    expect(entry).toContain("await fetch(url");
    expect(entry).toContain("agent-native-netlify-keep-warm");
    expect(entry).toContain("return new URL(request.url).origin");
    expect(entry).not.toMatch(/^\s*path:/m);
  });

  it("emits a durable recurring-job handoff beside the background worker", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);
    emitSingleTemplateNetlifyRecurringJobsFunction(cwd);

    const entryPath = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      NETLIFY_RECURRING_JOBS_FUNCTION_NAME,
      `${NETLIFY_RECURRING_JOBS_FUNCTION_NAME}.mjs`,
    );
    const entry = fs.readFileSync(entryPath, "utf8");
    expect(entry).toContain('schedule: "* * * * *"');
    expect(entry).toContain(
      'const SWEEP_PATH = "/_agent-native/jobs/_process-sweep"',
    );
    expect(entry).toContain(
      'const BACKGROUND_PATH = "/.netlify/functions/server-agent-background"',
    );
    expect(entry).toContain('createHmac("sha256", secret)');
    expect(entry).toContain("__agentNativeProcessorRoute");
    expect(entry).toContain("A2A_SECRET is required");
    expect(entry).toContain("return new URL(request.url).origin");
    // The entry imports node:crypto, so the deploy packager rejects it unless
    // includedFiles is declared.
    expect(entry).toContain('import { createHmac } from "node:crypto"');
    expect(entry).toContain('includedFiles: ["**"]');
  });

  describe("keep-warm opt-out and cadence", () => {
    const KEEP_WARM_ENV_KEYS = [
      "AGENT_NATIVE_DISABLE_KEEP_WARM",
      "AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND",
      "AGENT_NATIVE_KEEP_WARM_SCHEDULE",
    ] as const;
    let saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      saved = {};
      for (const key of KEEP_WARM_ENV_KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of KEEP_WARM_ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it("is ON BY DEFAULT, at the historical once-a-minute cadence", () => {
      expect(isKeepWarmDeployEnabled()).toBe(true);
      expect(isKeepWarmBackgroundDeployEnabled()).toBe(true);
      expect(resolveKeepWarmSchedule()).toBe("* * * * *");
    });

    it("emits nothing when keep-warm is disabled, so the DB can autosuspend", () => {
      process.env.AGENT_NATIVE_DISABLE_KEEP_WARM = "1";
      const cwd = setupNetlifyOutput();

      emitSingleTemplateNetlifyKeepWarmFunction(cwd);

      expect(fs.existsSync(keepWarmDir(cwd))).toBe(false);
    });

    it("honours an overridden cron cadence", () => {
      process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE = "*/5 * * * *";
      const cwd = setupNetlifyOutput();

      emitSingleTemplateNetlifyKeepWarmFunction(cwd);

      const entry = fs.readFileSync(
        path.join(keepWarmDir(cwd), "agent-native-keep-warm.mjs"),
        "utf8",
      );
      expect(entry).toContain('schedule: "*/5 * * * *"');
      expect(entry).not.toContain('schedule: "* * * * *"');
    });

    it("THROWS on an unparseable cadence instead of silently keeping 1/min", () => {
      // Falling back would leave an operator who set this to stop burning
      // database quota still burning it, with a green build and no warning.
      process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE = "every 5 minutes";
      expect(() => resolveKeepWarmSchedule()).toThrow(
        /must be a 5-field cron expression/,
      );

      const cwd = setupNetlifyOutput();
      expect(() => emitSingleTemplateNetlifyKeepWarmFunction(cwd)).toThrow(
        /AGENT_NATIVE_KEEP_WARM_SCHEDULE/,
      );
      // And it throws BEFORE wiping/writing the function dir, so a failed build
      // never leaves a half-emitted artifact behind.
      expect(fs.existsSync(keepWarmDir(cwd))).toBe(false);
    });

    it("THROWS on a 5-token value whose fields are not cron fields", () => {
      // Counting tokens is not parsing them: "not a cron expression here" is
      // five whitespace-separated words and would otherwise ship to Netlify as
      // a schedule, which is the same silent-wrong-cadence failure above.
      for (const bad of [
        "not a cron expression here",
        "*/0 * * * *",
        "60 * * * *",
        "* * * * 9",
      ]) {
        process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE = bad;
        expect(() => resolveKeepWarmSchedule()).toThrow(
          /must be a 5-field cron expression/,
        );
      }
    });

    it("accepts the cron syntax operators an operator would actually reach for", () => {
      for (const good of [
        "*/5 * * * *",
        "0 */6 * * *",
        "15,45 3 * * 1-5",
        "0 0 1 JAN *",
      ]) {
        process.env.AGENT_NATIVE_KEEP_WARM_SCHEDULE = good;
        expect(resolveKeepWarmSchedule()).toBe(good);
      }
    });

    it("drops the background warm independently of the server warm", () => {
      // Warming `server` is one health request; warming `-background` is a
      // fresh container that pays the whole schema-probe fan-out.
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
      process.env.AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND = "1";
      try {
        const cwd = setupNetlifyOutput();
        emitSingleTemplateNetlifyBackgroundFunction(cwd);
        emitSingleTemplateNetlifyKeepWarmFunction(cwd);

        const entry = fs.readFileSync(
          path.join(keepWarmDir(cwd), "agent-native-keep-warm.mjs"),
          "utf8",
        );
        expect(entry).toContain("const BACKGROUND_WARM_PATH = null");
        // The server warm is untouched.
        expect(entry).toContain('const HEALTH_PATH = "/_agent-native/health"');
      } finally {
        delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
      }
    });
  });

  it("does not emit a keep-warm function without Nitro's server bundle", () => {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-bg-emit-"));
    dirs.push(cwd);

    emitSingleTemplateNetlifyKeepWarmFunction(cwd);

    expect(fs.existsSync(keepWarmDir(cwd))).toBe(false);
  });

  it("is ON BY DEFAULT so the -background function is emitted", () => {
    expect(isDurableBackgroundDeployEnabled()).toBe(true);
  });

  it("is ON only when explicitly opted in via a truthy flag", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = value;
      expect(isDurableBackgroundDeployEnabled()).toBe(true);
    }
  });

  it("is OFF for explicit falsy flag values", () => {
    for (const value of ["0", "false", "no", "off", "FALSE", " Off "]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = value;
      expect(isDurableBackgroundDeployEnabled()).toBe(false);
    }
  });

  it("stays ON for empty or unrecognized flag values", () => {
    for (const value of ["", "maybe"]) {
      process.env.AGENT_CHAT_DURABLE_BACKGROUND = value;
      expect(isDurableBackgroundDeployEnabled()).toBe(true);
    }
  });

  it("emits an async background function INTO the scanned functions-internal dir at its DEFAULT url (no custom path)", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);

    const dest = backgroundDir(cwd);
    // Emitted into the SCANNED functions-internal dir (NOT the build-output
    // `.netlify/functions/` dir) so Netlify discovers it and honors its config.
    // The standalone-into-`.netlify/functions/` attempt 404'd because that dir is
    // never scanned.
    expect(dest).toContain(
      path.join(".netlify", "functions-internal", "server-agent-background"),
    );
    // The function name MUST end in -background (Netlify async convention + the
    // runtime guard reads the -background Lambda-name suffix as a fallback).
    expect(path.basename(dest).endsWith("-background")).toBe(true);
    // Shares the SAME built handler bundle (imports ./main.mjs).
    expect(fs.existsSync(path.join(dest, "main.mjs"))).toBe(true);
    // The copied Nitro `/*` `server.mjs` entry is dropped so our entry is the
    // entrypoint (and the catch-all config.path is not re-registered here).
    expect(fs.existsSync(path.join(dest, "server.mjs"))).toBe(false);

    const entry = fs.readFileSync(
      path.join(dest, "server-agent-background.mjs"),
      "utf8",
    );
    expect(entry).toContain('await import("./main.mjs")');
    // background: true makes Netlify invoke it ASYNC (202) with the 15-min budget.
    expect(entry).toContain("background: true");
    // DOC-CORRECT FIX: NO custom config.path. The function keeps its default url
    // /.netlify/functions/server-agent-background; a custom path would REMOVE that
    // default url (and the prod probe of the custom framework-route path 404'd).
    expect(entry).not.toContain("path: PROCESS_RUN_PATH");
    // No `path:` config KEY (assert at line start; the word "path" still appears
    // in comments and in `url.pathname`).
    expect(entry).not.toMatch(/^\s*path:/m);
    expect(entry).toContain('includedFiles: ["**"]');
    // The entry REWRITES the incoming request path to the framework process-run
    // route before delegating to Nitro (it is reached at the default function url,
    // so the Nitro router needs the framework path).
    expect(entry).toContain(
      `const PROCESS_RUN_PATH = ${JSON.stringify(AGENT_CHAT_PROCESS_RUN_PATH)}`,
    );
    expect(entry).toContain(
      "url.pathname = processorPathFromBody(body) || PROCESS_RUN_PATH",
    );
    expect(entry).toContain(
      'const A2A_PROCESS_TASK_PATH = "/_agent-native/a2a/_process-task"',
    );
    expect(entry).toContain(
      'const BACKGROUND_PROCESSOR_FIELD = "__agentNativeProcessor"',
    );
    expect(entry).toContain('const BACKGROUND_PROCESSOR_ROUTE = "route"');
    expect(entry).toContain(
      'const BACKGROUND_PROCESSOR_ROUTE_FIELD = "__agentNativeProcessorRoute"',
    );
    expect(entry).toContain("function processorPathFromBody(body)");
    expect(entry).toContain('route.includes("/api/_agent-native-background/")');
    // It preserves the body (read once) and ALL headers (the HMAC Authorization
    // Bearer MUST survive — the plugin verifies it).
    expect(entry).toContain("await request.text()");
    expect(entry).toContain("headers: request.headers");
    // The entry marks the durable background runtime via a globalThis flag (NOT
    // process.env — that would trip the no-env-mutation guard) so the worker
    // reliably takes the ~13-min soft-timeout (the deployed Lambda name is not
    // guaranteed to end in -background).
    expect(entry).toContain(
      "globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true",
    );
    // The wrapper passes Netlify's (request, context) through to the Nitro
    // handler and guards the handoff so a pre-route failure is logged loudly
    // instead of silently swallowed behind the async 202.
    expect(entry).toContain("async function handler(request, context)");
    expect(entry).toContain("cachedHandler(rewritten, context)");
    expect(entry).toMatch(/try\s*\{/);
    expect(entry).toContain("wrapper failed before reaching the route");
  });

  it("hard-links the handler bundle instead of writing a second copy of it", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);

    const source = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_libs",
      "yjs.mjs",
    );
    const clone = path.join(backgroundDir(cwd), "_libs", "yjs.mjs");
    // Same inode: the extra function costs its entry file, not another whole
    // server bundle. Netlify still zips each function separately, so this is
    // invisible to the deploy — a hard link IS a regular file to every reader.
    expect(fs.statSync(clone).ino).toBe(fs.statSync(source).ino);
  });

  it("does NOT touch the server /* catch-all (no excludedPath patch — default url is never shadowed)", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);

    // The Nitro `server` function's `server.mjs` must be left BYTE-FOR-BYTE
    // unchanged. We no longer patch its catch-all: the background function lives
    // at its default url /.netlify/functions/<name>, and the server catch-all
    // already excludes /.netlify/* — so there is nothing to shadow and no patch.
    const serverEntry = fs.readFileSync(serverEntryPath(cwd), "utf8");
    expect(serverEntry).toBe(SERVER_ENTRY);
    // The process-run framework route must NOT appear in the server entry's
    // excludedPath (the old patch added it; the doc-correct fix does not).
    expect(serverEntry).not.toContain(AGENT_CHAT_PROCESS_RUN_PATH);
    // The /* catch-all and the pre-existing /.netlify/* exclude are intact.
    expect(serverEntry).toContain('path: "/*"');
    expect(serverEntry).toContain('excludedPath: ["/.netlify/*"]');
  });

  it("is idempotent: re-emitting leaves the server entry unchanged", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);
    emitSingleTemplateNetlifyBackgroundFunction(cwd);

    // Re-emit must not accumulate any catch-all changes (there are none to make).
    const serverEntry = fs.readFileSync(serverEntryPath(cwd), "utf8");
    expect(serverEntry).toBe(SERVER_ENTRY);
  });

  it("skips emit (no -background artifact) when Nitro output is missing", () => {
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-bg-emit-"));
    dirs.push(cwd);
    // No .netlify/functions-internal/server/main.mjs present.
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "false";
    process.env.AGENT_NATIVE_DISABLE_RECURRING_JOBS = "true";

    expect(() =>
      emitSingleTemplateNetlifyBackgroundFunction(cwd),
    ).not.toThrow();
    expect(fs.existsSync(backgroundDir(cwd))).toBe(false);
  });

  it("FAILS the build instead of warning when the opted-in emit cannot run", () => {
    // agent-native-plan shipped for its whole history without this function:
    // the emit warned, the build stayed green, and every chat turn silently ran
    // on the ~60s synchronous wall.
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    const cwd = fs.mkdtempSync(path.join(process.cwd(), ".tmp-bg-emit-"));
    dirs.push(cwd);

    expect(() => emitSingleTemplateNetlifyBackgroundFunction(cwd)).toThrow(
      /Durable-background emit skipped/,
    );
    expect(fs.existsSync(backgroundDir(cwd))).toBe(false);
  });

  it("rejects a partially emitted background function", () => {
    const dest = fs.mkdtempSync(path.join(process.cwd(), ".tmp-bg-emit-"));
    dirs.push(dest);
    fs.writeFileSync(
      path.join(dest, "server-agent-background.mjs"),
      "export default () => {};\n",
    );

    expect(() =>
      assertEmittedBackgroundFunctionOnDisk(dest, "server-agent-background"),
    ).toThrow(/missing main\.mjs/);

    fs.writeFileSync(path.join(dest, "main.mjs"), "export default {};\n");
    expect(() =>
      assertEmittedBackgroundFunctionOnDisk(dest, "server-agent-background"),
    ).not.toThrow();
  });

  it("parses the deploy gate exactly like the runtime gate", () => {
    // Three copies of this flag parse existed; one of them was inverted.
    process.env.NETLIFY = "true";
    process.env.A2A_SECRET = "shhh";
    try {
      for (const value of [undefined, "", "true", "1", "false", "off", "?"]) {
        if (value === undefined)
          delete process.env.AGENT_CHAT_DURABLE_BACKGROUND;
        else process.env.AGENT_CHAT_DURABLE_BACKGROUND = value;
        expect(isDurableBackgroundDeployEnabled()).toBe(
          isAgentChatDurableBackgroundEnabled(),
        );
      }
    } finally {
      delete process.env.NETLIFY;
      delete process.env.A2A_SECRET;
    }
  });

  it("keeps the background function warm too when durable background is on", () => {
    // The background Lambda is a separate container; warming only the health
    // route left it cold-starting on essentially every dispatch.
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);
    emitSingleTemplateNetlifyKeepWarmFunction(cwd);

    const entry = fs.readFileSync(
      path.join(keepWarmDir(cwd), "agent-native-keep-warm.mjs"),
      "utf8",
    );
    expect(entry).toContain(
      'const BACKGROUND_WARM_PATH = "/.netlify/functions/server-agent-background"',
    );
    // A body with no runId is rejected by the _process-run route before any DB
    // work, so the ping only keeps the container alive.
    expect(entry).toContain('body: "{}"');
    expect(entry).toContain('method: "POST"');
  });

  it("does not ping a background function that was never emitted", () => {
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyKeepWarmFunction(cwd);

    const entry = fs.readFileSync(
      path.join(keepWarmDir(cwd), "agent-native-keep-warm.mjs"),
      "utf8",
    );
    expect(entry).toContain("const BACKGROUND_WARM_PATH = null");
  });

  function prepareSingleTemplateNetlifyOutput(
    cwd: string,
    options: { emitBackground?: boolean } = {},
  ): void {
    if (options.emitBackground !== false) {
      emitSingleTemplateNetlifyBackgroundFunction(cwd);
    }
    writeSingleTemplateNetlifyRedirects(cwd);
  }

  it("passes a valid single-template Netlify deploy output", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).not.toThrow();
  });

  it("fails a function that ships more than the per-function size budget", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const chromiumDir = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "node_modules",
      "@sparticuz",
      "chromium",
      "bin",
    );
    fs.mkdirSync(chromiumDir, { recursive: true });
    // Sparse: getDirSize reports apparent size, which is what the deploy zip
    // pays for, so the test costs no disk.
    const fd = fs.openSync(path.join(chromiumDir, "chromium.br"), "w");
    fs.ftruncateSync(fd, 130 * 1024 * 1024);
    fs.closeSync(fd);

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /function server is 130\.0MB, over the 120\.0MB budget — largest: @sparticuz/,
    );
  });

  it("passes workspace deploy output with client assets under the normalized app base path", () => {
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.APP_BASE_PATH = " //dispatch// ";
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    fs.mkdirSync(path.join(cwd, "dist", "dispatch"), { recursive: true });
    fs.renameSync(
      path.join(cwd, "dist", "assets"),
      path.join(cwd, "dist", "dispatch", "assets"),
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).not.toThrow();
  });

  it("fails workspace deploy output without client assets under the app base path", () => {
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.APP_BASE_PATH = "/dispatch";
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /dist\/dispatch\/assets is missing hashed client assets/,
    );
  });

  it("removes the incompatible default-function rewrite while keeping real redirects", () => {
    const cwd = setupNetlifyOutput();
    const redirectsPath = path.join(cwd, "dist", "_redirects");
    fs.writeFileSync(
      redirectsPath,
      [
        "https://images.agent-native.com/* https://assets.agent-native.com/:splat 301!",
        "# Generated by agent-native build for Netlify single-template deploys",
        "# Static files are served first; dynamic routes fall through to the server function.",
        "/* /.netlify/functions/server 200",
        "",
      ].join("\n"),
    );

    writeSingleTemplateNetlifyRedirects(cwd);

    const redirects = fs.readFileSync(redirectsPath, "utf-8");
    expect(redirects).toContain(
      "https://images.agent-native.com/* https://assets.agent-native.com/:splat 301!",
    );
    expect(redirects).not.toContain("/* /.netlify/functions/server 200");
  });

  it("fails deploy output that still rewrites to the removed default function URL", () => {
    const cwd = setupNetlifyOutput();
    writeSingleTemplateNetlifyRedirects(cwd);
    fs.writeFileSync(
      path.join(cwd, "dist", "_redirects"),
      "/* /.netlify/functions/server 200\n",
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /must not contain "\/\* \/\.netlify\/functions\/server 200"/,
    );
  });

  it("fails deploy output that would publish without preferStatic true", () => {
    const cwd = setupNetlifyOutput();
    writeSingleTemplateNetlifyRedirects(cwd);
    const entry = fs.readFileSync(serverEntryPath(cwd), "utf8");
    fs.writeFileSync(
      serverEntryPath(cwd),
      entry.replace("preferStatic: true", "preferStatic: false"),
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /preferStatic: true/,
    );
  });

  it("fails deploy output with a bare Yjs runtime import", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const collabChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "collab.mjs",
    );
    fs.mkdirSync(path.dirname(collabChunk), { recursive: true });
    fs.writeFileSync(collabChunk, 'import * as Y from "yjs";\nexport { Y };\n');

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /leaves yjs as a runtime import/,
    );
  });

  it("fails deploy output with bare ingestion runtime imports", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const ingestionChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "pptx.mjs",
    );
    fs.mkdirSync(path.dirname(ingestionChunk), { recursive: true });
    fs.writeFileSync(
      ingestionChunk,
      "export const dependencies = Promise.all([import(`jszip`), import(`fast-xml-parser`)]);\n",
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /leaves ingestion dependencies as runtime imports: jszip .*fast-xml-parser|leaves ingestion dependencies as runtime imports: fast-xml-parser .*jszip/,
    );
  });

  it("fails deploy output with bare PDF runtime subpath imports", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const ingestionChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "pdf.mjs",
    );
    fs.mkdirSync(path.dirname(ingestionChunk), { recursive: true });
    fs.writeFileSync(
      ingestionChunk,
      'export const dependencies = Promise.all([import("pdf-parse/worker"), import("pdfjs-dist/legacy/build/pdf.mjs")]);\n',
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /leaves ingestion dependencies as runtime imports: pdf-parse .*pdfjs-dist|leaves ingestion dependencies as runtime imports: pdfjs-dist .*pdf-parse/,
    );
  });

  it("fails deploy output with bare Office parser runtime imports", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const ingestionChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "office.mjs",
    );
    fs.mkdirSync(path.dirname(ingestionChunk), { recursive: true });
    fs.writeFileSync(
      ingestionChunk,
      'export const dependency = import("officeparser");\n',
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /leaves ingestion dependencies as runtime imports: officeparser/,
    );
  });

  it("fails deploy output wired to Nitro's private tree-shaken Yjs chunk", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const serverChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "server3.mjs",
    );
    fs.mkdirSync(path.dirname(serverChunk), { recursive: true });
    fs.writeFileSync(
      serverChunk,
      'import { Text } from "../_libs/yjs.mjs";\nexport { Text };\n',
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /internal tree-shaken _libs\/yjs\.mjs/,
    );
  });

  it("fails deploy output containing the Vitest test runtime", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const serverChunk = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
      "_chunks",
      "server.mjs",
    );
    fs.mkdirSync(path.dirname(serverChunk), { recursive: true });
    fs.writeFileSync(
      serverChunk,
      'const runtime = "@vitest/runner"; export { runtime };\n',
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /contains Vitest test runtime code/,
    );
  });

  it("bundles one complete Yjs runtime for every serverless consumer", async () => {
    const cwd = setupNetlifyOutput();
    const serverDir = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
    );
    const collabChunk = path.join(serverDir, "_chunks", "collab.mjs");
    const editorChunk = path.join(serverDir, "_chunks", "editor.mjs");
    const nitroChunk = path.join(serverDir, "_chunks", "nitro-yjs.mjs");
    fs.mkdirSync(path.dirname(collabChunk), { recursive: true });
    fs.writeFileSync(
      collabChunk,
      'import * as Y from "yjs";\nexport { Y };\nexport const doc = new Y.Doc();\n',
    );
    fs.writeFileSync(
      editorChunk,
      'import { Text, UndoManager } from "yjs";\nexport { Text, UndoManager };\n',
    );
    fs.writeFileSync(
      nitroChunk,
      'import { Text } from "../_libs/yjs.mjs";\nexport { Text };\n',
    );

    expect(bundleYjsRuntimeForServerlessOutput(serverDir, cwd)).toEqual([
      collabChunk,
      editorChunk,
    ]);
    const runtime = fs.readFileSync(
      path.join(serverDir, "_libs", "yjs-runtime.mjs"),
      "utf-8",
    );
    expect(runtime).toMatch(/Text/);
    expect(runtime).toMatch(/UndoManager/);
    expect(fs.readFileSync(collabChunk, "utf-8")).toContain(
      'from "../_libs/yjs-runtime.mjs"',
    );
    expect(fs.readFileSync(editorChunk, "utf-8")).toContain(
      'from "../_libs/yjs-runtime.mjs"',
    );
    expect(fs.readFileSync(nitroChunk, "utf-8")).toContain(
      'from "../_libs/yjs-runtime.mjs"',
    );
    const [collab, editor] = await Promise.all([
      import(`${pathToFileURL(collabChunk).href}?t=${Date.now()}`),
      import(`${pathToFileURL(editorChunk).href}?t=${Date.now()}`),
    ]);
    expect(collab.Y.Text).toBe(editor.Text);
    expect(collab.doc.getText("x")).toBeInstanceOf(editor.Text);
    prepareSingleTemplateNetlifyOutput(cwd);
    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).not.toThrow();
  });

  it("rejects unsupported Yjs subpath imports instead of rewriting their semantics", () => {
    const cwd = setupNetlifyOutput();
    const serverDir = path.join(
      cwd,
      ".netlify",
      "functions-internal",
      "server",
    );
    const collabChunk = path.join(serverDir, "_chunks", "collab.mjs");
    fs.mkdirSync(path.dirname(collabChunk), { recursive: true });
    fs.writeFileSync(
      collabChunk,
      'import * as Y from "yjs/src/index.js";\nexport { Y };\n',
    );

    expect(() => bundleYjsRuntimeForServerlessOutput(serverDir, cwd)).toThrow(
      /unsupported yjs subpath imports/,
    );
  });

  it("fails deploy output that would publish without client assets in dist", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    fs.rmSync(path.join(cwd, "dist", "assets"), {
      recursive: true,
      force: true,
    });

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /dist\/assets is missing hashed client assets/,
    );
  });

  it("fails deploy output that would publish without the server catch-all", () => {
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd);
    const entry = fs.readFileSync(serverEntryPath(cwd), "utf8");
    fs.writeFileSync(
      serverEntryPath(cwd),
      entry.replace('  path: "/*",\n', ""),
    );

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /missing the "\/\*" catch-all/,
    );
  });

  it("fails when durable background is enabled but the Netlify background function is missing", () => {
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    const cwd = setupNetlifyOutput();
    prepareSingleTemplateNetlifyOutput(cwd, { emitBackground: false });

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).toThrow(
      /durable background is enabled/,
    );
  });

  it("passes durable-background deploy output after the background function is emitted", () => {
    process.env.AGENT_CHAT_DURABLE_BACKGROUND = "true";
    const cwd = setupNetlifyOutput();

    emitSingleTemplateNetlifyBackgroundFunction(cwd);
    prepareSingleTemplateNetlifyOutput(cwd);

    expect(() => assertSingleTemplateNetlifyBuildOutput(cwd)).not.toThrow();
  });
});
