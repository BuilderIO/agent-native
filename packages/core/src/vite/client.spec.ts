import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseChangelog } from "../changelog/parse.js";
import { signEmbedSessionToken } from "../server/embed-session.js";
import {
  _debounceNitroFullReloadHotUpdate,
  _findCorePackageRoot,
  _getClientDedupe,
  _getDefaultOptimizeDeps,
  _getReactRouterAliases,
  agentNative,
  defineConfig,
  isFrameworkDevPath,
  stripMountedDevApiPath,
} from "./client.js";

function findPlugin(name: string) {
  const plugins = (defineConfig().plugins ?? [])
    .flat()
    .filter(Boolean) as any[];
  const plugin = plugins.find((p) => p?.name === name);
  expect(plugin).toBeDefined();
  return plugin;
}

function flatPlugins(plugins: any[] | undefined): any[] {
  return (plugins ?? []).flat().filter(Boolean) as any[];
}

describe("dev server mounted path helpers", () => {
  const previousSecret = process.env.OAUTH_STATE_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.OAUTH_STATE_SECRET;
    } else {
      process.env.OAUTH_STATE_SECRET = previousSecret;
    }
  });

  it("strips mounted API paths including the /api index route", () => {
    expect(stripMountedDevApiPath("/docs/api/events", "/docs/")).toBe(
      "/api/events",
    );
    expect(stripMountedDevApiPath("/docs/api?ping=1", "/docs/")).toBe(
      "/api?ping=1",
    );
  });

  it("does not strip lookalike paths", () => {
    expect(stripMountedDevApiPath("/docs/apis/events", "/docs/")).toBe(
      "/docs/apis/events",
    );
    expect(stripMountedDevApiPath("/docs-extra/api/events", "/docs/")).toBe(
      "/docs-extra/api/events",
    );
  });

  it("recognizes framework paths with and without the mounted base", () => {
    expect(isFrameworkDevPath("/_agent-native/ping", "/docs/")).toBe(true);
    expect(isFrameworkDevPath("/docs/_agent-native/ping", "/docs/")).toBe(true);
    expect(isFrameworkDevPath("/docs/_agent-native", "/docs/")).toBe(true);
    expect(isFrameworkDevPath("/docs-extra/_agent-native/ping", "/docs/")).toBe(
      false,
    );
  });

  it("serves base-prefixed Vite module requests for embed sessions", async () => {
    process.env.OAUTH_STATE_SECRET = "vite-embed-test-secret";
    const plugin = findPlugin("agent-native-base-redirect-guard");
    let middleware: Function | null = null;
    const server = {
      config: { base: "/assets/", publicDir: "/tmp/no-public" },
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
      pluginContainer: {
        load: vi.fn(async (id: string) => ({
          code: `window.__loaded = ${JSON.stringify(id)};`,
        })),
      },
      transformRequest: vi.fn(async (url: string) => ({
        code: `export const url = ${JSON.stringify(url)};`,
      })),
    };

    plugin.configureServer(server);
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/picker?mediaType=image",
      ttlSeconds: 60,
    });
    const req = {
      method: "GET",
      url:
        `/assets/@id/__x00__virtual:react-router/browser-manifest` +
        `?__an_embed_token=${token}&__an_mcp_chat_bridge=1`,
      headers: {},
    };
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(() => {
        res.headersSent = true;
      }),
    };
    const next = vi.fn();

    middleware!(req, res, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());

    expect(next).not.toHaveBeenCalled();
    expect(server.pluginContainer.load).toHaveBeenCalledWith(
      "\0virtual:react-router/browser-manifest",
    );
    expect(server.transformRequest).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      "content-type",
      "text/javascript",
    );
    expect(res.end).toHaveBeenCalledWith(
      'window.__loaded = "\\u0000virtual:react-router/browser-manifest";',
    );
  });

  it("serves absolute React Router browser manifests to external MCP embeds", async () => {
    const plugin = findPlugin("agent-native-base-redirect-guard");
    let middleware: Function | null = null;
    const server = {
      config: { base: "/", publicDir: "/tmp/no-public" },
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
      pluginContainer: {
        load: vi.fn(async () => ({
          code:
            "window.__reactRouterManifest={" +
            "'url':'/@id/__x00__virtual:react-router/browser-manifest'," +
            "'entry':{'module':'/app/entry.client.tsx'}," +
            "'hmr':{'runtime':'/@id/__x00__virtual:react-router/inject-hmr-runtime'}," +
            "'routes':{'root':{'module':'/app/root.tsx'}}" +
            "};",
        })),
      },
      transformRequest: vi.fn(),
    };

    plugin.configureServer(server);
    const req = {
      method: "GET",
      url: "/@id/__x00__virtual:react-router/browser-manifest",
      headers: {
        origin: "http://127.0.0.1:9310",
        host: "assets-local.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    };
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(() => {
        res.headersSent = true;
      }),
    };
    const next = vi.fn();

    middleware!(req, res, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce());

    expect(next).not.toHaveBeenCalled();
    expect(server.pluginContainer.load).toHaveBeenCalledWith(
      "\0virtual:react-router/browser-manifest",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "content-type",
      "text/javascript",
    );
    expect(String(res.end.mock.calls[0][0])).toContain(
      '"https://assets-local.trycloudflare.com/app/entry.client.tsx"',
    );
    expect(String(res.end.mock.calls[0][0])).toContain(
      '"https://assets-local.trycloudflare.com/@id/__x00__virtual:react-router/browser-manifest"',
    );
  });

  it("does not serve base-prefixed Vite modules without embed auth", () => {
    const plugin = findPlugin("agent-native-base-redirect-guard");
    let middleware: Function | null = null;
    const server = {
      config: { base: "/assets/", publicDir: "/tmp/no-public" },
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
      transformRequest: vi.fn(),
    };

    plugin.configureServer(server);
    const next = vi.fn();
    middleware!(
      {
        method: "GET",
        url: "/assets/@id/__x00__virtual:react-router/browser-manifest",
        headers: {},
      },
      { setHeader: vi.fn() },
      next,
    );

    expect(server.transformRequest).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("Vite optimized dependency recovery", () => {
  it("injects browser recovery hooks before module scripts load", () => {
    const plugin = findPlugin("agent-native-auto-reload-optimize-dep");
    const tags = plugin.transformIndexHtml();
    const script = tags?.[0]?.children ?? "";

    expect(tags?.[0]?.injectTo).toBe("head-prepend");
    expect(script).toContain("vite:preloadError");
    expect(script).toContain("PerformanceObserver");
    expect(script).toContain("Outdated Optimize Dep");
  });

  it("asks the Vite client to reload when Vite returns an outdated optimized dep 504", () => {
    const plugin = findPlugin("agent-native-full-reload-optimize-dep-504");
    let middleware: Function | null = null;
    const server = {
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
      ws: { send: vi.fn() },
      config: { logger: { info: vi.fn() } },
    };

    plugin.configureServer(server);
    expect(middleware).toBeTypeOf("function");

    const req = { url: "/node_modules/.vite/deps/react.js?v=stale" };
    const originalEnd = vi.fn();
    const res = {
      statusCode: 504,
      statusMessage: "Outdated Optimize Dep",
      end: originalEnd,
    };
    const next = vi.fn();

    middleware!(req, res, next);
    res.end();

    expect(next).toHaveBeenCalledOnce();
    expect(server.ws.send).toHaveBeenCalledWith({ type: "full-reload" });
    expect(server.config.logger.info).toHaveBeenCalledOnce();
    expect(originalEnd).toHaveBeenCalledOnce();
  });
});

describe("route warmup config", () => {
  it("enables safe React Router route warmup by default", () => {
    const config = defineConfig();
    const routeWarmup = JSON.parse(
      String(config.define?.__AGENT_NATIVE_ROUTE_WARMUP_CONFIG__),
    );

    expect(routeWarmup).toEqual({
      strategy: "intent",
      data: true,
      modules: true,
      selector: 'a[data-an-prefetch="render"][href]',
      maxConcurrent: 4,
    });
  });

  it("allows apps to choose a route warmup strategy in one Vite config place", () => {
    const config = defineConfig({
      routeWarmup: { strategy: "render", maxConcurrent: 8 },
      define: { __APP_DEFINE__: JSON.stringify("ok") },
    });
    const routeWarmup = JSON.parse(
      String(config.define?.__AGENT_NATIVE_ROUTE_WARMUP_CONFIG__),
    );

    expect(routeWarmup.strategy).toBe("render");
    expect(routeWarmup.maxConcurrent).toBe(8);
    expect(routeWarmup.data).toBe(true);
    expect(routeWarmup.modules).toBe(true);
    expect(config.define?.__APP_DEFINE__).toBe(JSON.stringify("ok"));
  });

  it("does not let app define options override the framework route warmup config", () => {
    const config = defineConfig({
      routeWarmup: { strategy: "viewport" },
      define: {
        __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__: JSON.stringify({
          strategy: "off",
        }),
      },
    });
    const routeWarmup = JSON.parse(
      String(config.define?.__AGENT_NATIVE_ROUTE_WARMUP_CONFIG__),
    );

    expect(routeWarmup.strategy).toBe("viewport");
  });

  it("exposes the build-time GA measurement id for SSR bundles", () => {
    const previous = process.env.GA_MEASUREMENT_ID;
    process.env.GA_MEASUREMENT_ID = "  G-UNITTEST123  ";

    try {
      const config = defineConfig();

      expect(config.define?.__AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__).toBe(
        JSON.stringify("G-UNITTEST123"),
      );
      expect(
        config.define?.["process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID"],
      ).toBe(JSON.stringify("G-UNITTEST123"));
    } finally {
      if (previous === undefined) {
        delete process.env.GA_MEASUREMENT_ID;
      } else {
        process.env.GA_MEASUREMENT_ID = previous;
      }
    }
  });
});

describe("MCP integrations config", () => {
  it("exposes default MCP integration catalog settings", () => {
    const config = defineConfig();
    const mcpIntegrations = JSON.parse(
      String(config.define?.__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__),
    );

    expect(mcpIntegrations).toEqual({
      enabled: true,
      custom: true,
      defaults: { enabled: true, exclude: [] },
    });
  });

  it("lets products disable or filter default MCP integration presets", () => {
    const config = defineConfig({
      mcpIntegrations: {
        defaults: { include: ["context7", "sentry"], exclude: ["sentry"] },
        custom: false,
      },
    });
    const mcpIntegrations = JSON.parse(
      String(config.define?.__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__),
    );

    expect(mcpIntegrations).toEqual({
      enabled: true,
      custom: false,
      defaults: {
        enabled: true,
        include: ["context7", "sentry"],
        exclude: ["sentry"],
      },
    });
  });

  it("lets products hide the whole MCP integrations entry", () => {
    const config = defineConfig({ mcpIntegrations: false });
    const mcpIntegrations = JSON.parse(
      String(config.define?.__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__),
    );

    expect(mcpIntegrations.enabled).toBe(false);
    expect(mcpIntegrations.custom).toBe(false);
    expect(mcpIntegrations.defaults.enabled).toBe(false);
  });
});

describe("agentNative Vite plugin preset", () => {
  it("returns a Vite preset with framework plugins and a config hook", () => {
    const plugins = flatPlugins(agentNative({ ssrStubs: ["yjs"] }));
    const pluginNames = plugins.map((p) => p?.name);

    expect(pluginNames[0]).toBe("agent-native-config");
    expect(pluginNames).toContain("agent-native-ssr-stub-heavy-libs");
    expect(pluginNames).toContain("agent-native-app-changelog-raw");
    expect(pluginNames).toContain("agent-native-action-types");
    expect(pluginNames).toContain("agent-native-agents-bundle");
    expect(pluginNames).toContain("agent-native-auto-reload-optimize-dep");
    expect(pluginNames).toContain("agent-native-port-exposer");
  });

  it("applies framework defaults without clobbering ordinary Vite config", async () => {
    const plugins = flatPlugins(
      agentNative({ routeWarmup: { strategy: "render" } }),
    );
    const configPlugin = plugins.find((p) => p?.name === "agent-native-config");

    const config = (await configPlugin.config(
      {
        define: {
          __APP_DEFINE__: JSON.stringify("ok"),
          __AGENT_NATIVE_ROUTE_WARMUP_CONFIG__: JSON.stringify({
            strategy: "off",
          }),
        },
        server: {
          port: 4242,
          fs: {
            allow: ["/tmp/app-assets"],
            deny: ["secret.txt"],
          },
        },
        build: {
          outDir: "build/client",
        },
        optimizeDeps: {
          include: ["date-fns"],
          exclude: ["lodash"],
        },
        resolve: {
          dedupe: ["zustand"],
          alias: { "~": "/tmp/app" },
        },
      },
      { command: "serve", mode: "development" },
    )) as any;

    const routeWarmup = JSON.parse(
      String(config.define.__AGENT_NATIVE_ROUTE_WARMUP_CONFIG__),
    );

    expect(config.plugins).toBeUndefined();
    expect(routeWarmup.strategy).toBe("render");
    expect(config.define.__APP_DEFINE__).toBe(JSON.stringify("ok"));
    expect(config.define.__AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID__).toBe(
      JSON.stringify(process.env.GA_MEASUREMENT_ID?.trim() || ""),
    );
    expect(
      config.define["process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID"],
    ).toBe(JSON.stringify(process.env.GA_MEASUREMENT_ID?.trim() || ""));
    expect(config.server.port).toBe(4242);
    expect(config.server.fs.allow).toContain("/tmp/app-assets");
    expect(config.server.fs.deny).toContain("secret.txt");
    expect(config.build.outDir).toBe("build/client");
    expect(config.build.cssMinify).toBe("esbuild");
    expect(config.optimizeDeps.include).toContain("date-fns");
    expect(config.optimizeDeps.exclude).toContain("lodash");
    expect(config.resolve.dedupe).toContain("zustand");
    expect(config.resolve.alias).toContainEqual({
      find: "~",
      replacement: "/tmp/app",
    });
  });

  it("externalizes singleton and native deps for production SSR builds", async () => {
    const plugins = flatPlugins(agentNative());
    const configPlugin = plugins.find((p) => p?.name === "agent-native-config");

    const config = (await configPlugin.config(
      {
        ssr: {
          external: ["custom-native-package"],
        },
      },
      { command: "build", mode: "production" },
    )) as any;

    expect(config.ssr.external).toContain("yjs");
    expect(config.ssr.external).toContain("better-sqlite3");
    expect(config.ssr.external).toContain("bindings");
    expect(config.ssr.external).toContain("custom-native-package");
  });

  it("keeps legacy defineConfig caller plugins before framework plugins", () => {
    const callerPlugin = { name: "react-router" };
    const config = defineConfig({ plugins: [callerPlugin] });
    const pluginNames = flatPlugins(config.plugins as any[]).map((p) => p.name);

    expect(pluginNames.indexOf("react-router")).toBeLessThan(
      pluginNames.indexOf("agent-native-action-types"),
    );
    expect(pluginNames).not.toContain("@vitejs/plugin-react-swc");
  });
});

describe("app changelog raw imports", () => {
  it("merges pending app changelog entries into CHANGELOG.md?raw", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-changelog-raw-"));
    const appDir = path.join(tmpDir, "app");
    const pendingDir = path.join(tmpDir, "changelog");
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "CHANGELOG.md"),
      "# Changelog\n\n## 2026-06-23\n\n### Added\n\n- Seed entry.\n",
    );
    fs.writeFileSync(
      path.join(pendingDir, "2026-07-01-new-thing.md"),
      "---\ntype: added\n---\n\nNew visible thing.\n",
    );
    fs.writeFileSync(
      path.join(pendingDir, "2026-06-23-same-day.md"),
      "---\ntype: fixed\ndate: 2026-06-23\n---\n\nSame-day fix.\n",
    );

    try {
      const plugin = findPlugin("agent-native-app-changelog-raw");
      const importer = path.join(appDir, "root.tsx");
      const resolved = await plugin.resolveId("../CHANGELOG.md?raw", importer);
      expect(resolved).toBe(`${path.join(tmpDir, "CHANGELOG.md")}?raw`);

      const watched: string[] = [];
      const code = await plugin.load.call(
        { addWatchFile: (file: string) => watched.push(file) },
        resolved,
      );
      const markdown = JSON.parse(
        String(code)
          .replace(/^export default /, "")
          .replace(/;$/, ""),
      );
      const entries = parseChangelog(markdown);

      expect(watched).toContain(path.join(tmpDir, "CHANGELOG.md"));
      // Watch the individual pending files, never the directory itself: Vite's
      // import-analysis would try to resolve a watched directory as a module
      // and fail ("Failed to resolve import .../changelog"), breaking
      // hydration. New/removed files are still caught by the root dev watcher.
      expect(watched).toContain(
        path.join(pendingDir, "2026-07-01-new-thing.md"),
      );
      expect(watched).toContain(
        path.join(pendingDir, "2026-06-23-same-day.md"),
      );
      expect(watched).not.toContain(pendingDir);
      expect(entries.map((entry) => entry.title)).toEqual([
        "2026-07-01",
        "2026-06-23",
      ]);
      expect(entries.map((entry) => entry.title)).not.toContain("Unreleased");
      expect(entries[0].body).toContain("New visible thing.");
      expect(entries[1].body).toContain("Same-day fix.");
      expect(entries[1].body).toContain("Seed entry.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps changelog directories visible to the dev watcher", () => {
    const ignored =
      (
        (
          defineConfig().server as
            | { watch?: { ignored?: string[] } }
            | undefined
        )?.watch ?? {}
      ).ignored ?? [];

    expect(ignored).not.toContain("**/changelog/**");
  });
});

describe("Vite MCP embed headers", () => {
  it("adds COEP-compatible headers to embed-token page loads in dev", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);
    expect(middleware).toBeTypeOf("function");

    const setHeader = vi.fn();
    middleware!(
      { url: "/inbox?embedded=1&__an_embed_token=tok", headers: {} },
      { setHeader },
      vi.fn(),
    );

    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Embedder-Policy",
      "require-corp",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Opener-Policy",
      "same-origin",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
    expect(setHeader).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
  });

  it("adds the same headers when an embed session cookie is present", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);

    const setHeader = vi.fn();
    middleware!(
      { url: "/inbox", headers: { cookie: "an_embed_session=tok" } },
      { setHeader },
      vi.fn(),
    );

    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Embedder-Policy",
      "require-corp",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Opener-Policy",
      "same-origin",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
  });

  it("adds CORS/CORP headers to null-origin sandbox subresources in dev", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);

    const setHeader = vi.fn();
    middleware!(
      { url: "/app/entry.client.tsx", headers: { origin: "null" } },
      { setHeader },
      vi.fn(),
    );

    expect(setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "null",
    );
    expect(setHeader).toHaveBeenCalledWith("Vary", "Origin");
    expect(setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      expect.stringContaining("X-Agent-Native-Embed-Target"),
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
  });

  it("adds COEP-compatible headers to originless mounted CSS requests in dev", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      config: { base: "/assets/" },
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);

    const setHeader = vi.fn();
    middleware!(
      { url: "/assets/app/global.css?url", headers: {} },
      { setHeader },
      vi.fn(),
    );

    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
  });

  it("does not classify mounted app pages as originless static assets in dev", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      config: { base: "/assets/" },
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);

    const setHeader = vi.fn();
    middleware!(
      { url: "/assets/library", headers: {} },
      { setHeader },
      vi.fn(),
    );

    expect(setHeader).not.toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
    expect(setHeader).not.toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "cross-origin",
    );
  });

  it("answers null-origin sandbox preflights before Nitro dev middleware", () => {
    const plugin = findPlugin("agent-native-embed-dev-frame-headers");
    let middleware: Function | null = null;
    const server = {
      middlewares: {
        use: vi.fn((fn: Function) => {
          middleware = fn;
        }),
      },
    };

    plugin.configureServer(server);

    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 200 };
    const next = vi.fn();
    middleware!(
      {
        method: "OPTIONS",
        url: "/_agent-native/poll",
        headers: { origin: "null" },
      },
      res,
      next,
    );

    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("Vite connection reset noise", () => {
  it("suppresses benign reset errors before they reach the browser overlay", () => {
    const plugin = findPlugin("agent-native-silence-connection-resets");
    const loggerError = vi.fn();
    const hotSend = vi.fn();
    const wsSend = vi.fn();
    const server = {
      httpServer: { on: vi.fn() },
      config: { logger: { error: loggerError } },
      environments: { client: { hot: { send: hotSend } } },
      ws: { send: wsSend },
    };

    plugin.configureServer(server);

    server.config.logger.error("Internal server error: socket hang up", {
      error: { message: "socket hang up" },
    });
    expect(loggerError).not.toHaveBeenCalled();

    server.environments.client.hot.send({
      type: "error",
      err: { message: "read ECONNRESET", stack: "at TCP.onStreamRead" },
    });
    expect(hotSend).not.toHaveBeenCalled();

    server.environments.client.hot.send({
      type: "error",
      err: { message: "write ECONNRESET", stack: "at writeGeneric" },
    });
    expect(hotSend).not.toHaveBeenCalled();

    server.ws.send({
      type: "error",
      err: { message: "socket hang up", stack: "at Socket.socketOnEnd" },
    });
    expect(wsSend).not.toHaveBeenCalled();
  });

  it("keeps real Vite errors visible", () => {
    const plugin = findPlugin("agent-native-silence-connection-resets");
    const loggerError = vi.fn();
    const hotSend = vi.fn();
    const wsSend = vi.fn();
    const server = {
      httpServer: { on: vi.fn() },
      config: { logger: { error: loggerError } },
      environments: { client: { hot: { send: hotSend } } },
      ws: { send: wsSend },
    };

    plugin.configureServer(server);

    server.config.logger.error("Internal server error: syntax broke", {
      error: { message: "syntax broke" },
    });
    expect(loggerError).toHaveBeenCalledOnce();

    const payload = {
      type: "error",
      err: { message: "syntax broke", stack: "at transform" },
    };
    server.environments.client.hot.send(payload);
    server.ws.send(payload);

    expect(hotSend).toHaveBeenCalledWith(payload);
    expect(wsSend).toHaveBeenCalledWith(payload);
  });

  it("suppresses Node web stream close races from socket error handlers", () => {
    const plugin = findPlugin("agent-native-silence-connection-resets");
    let connectionHandler: ((socket: { on: Function }) => void) | undefined;
    let socketErrorHandler: ((err: Error) => void) | undefined;
    const server = {
      httpServer: {
        on: vi.fn((event: string, handler: typeof connectionHandler) => {
          if (event === "connection") connectionHandler = handler;
        }),
      },
      config: { logger: { error: vi.fn() } },
    };

    plugin.configureServer(server);
    connectionHandler?.({
      on: vi.fn((event: string, handler: typeof socketErrorHandler) => {
        if (event === "error") socketErrorHandler = handler;
      }),
    });

    const err = Object.assign(
      new TypeError("Invalid state: Controller is already closed"),
      {
        code: "ERR_INVALID_STATE",
        stack:
          "TypeError: Invalid state: Controller is already closed\n" +
          "    at ReadableStreamDefaultController.close " +
          "(node:internal/webstreams/readablestream:1068:13)\n" +
          "    at IncomingMessage.<anonymous> " +
          "(node:internal/webstreams/adapters:483:16)\n" +
          "    at IncomingMessage.onclose " +
          "(node:internal/streams/end-of-stream:161:14)",
      },
    );

    expect(() => socketErrorHandler?.(err)).not.toThrow();
    expect(() =>
      socketErrorHandler?.(Object.assign(new Error("real socket failure"), {})),
    ).toThrow("real socket failure");
  });
});

describe("Nitro dev full-reload debounce", () => {
  // These fakes mirror the shape nitro's own `hotUpdate` hook actually uses
  // (see nitro/dist/vite.mjs): `this.environment.moduleGraph.invalidateModule`
  // for every changed module, followed by `this.environment.hot.send({ type:
  // "full-reload" })`. We only need enough of that shape to exercise the
  // wrapper, not a real Vite dev server.
  function fakeNitroMainPlugin(
    handler: (
      this: { environment: any },
      options: { modules: string[] },
    ) => void,
  ) {
    return { name: "nitro:main", hotUpdate: handler } as any;
  }

  it("coalesces a burst of full-reload sends into exactly one after quiescence", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const plugin = _debounceNitroFullReloadHotUpdate(
        fakeNitroMainPlugin(function () {
          this.environment.hot.send({ type: "full-reload" });
        }),
      );
      const context = { environment: { name: "ssr", hot: { send } } };

      for (let i = 0; i < 5; i++) {
        plugin.hotUpdate.call(context, { modules: [] });
      }

      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: "full-reload" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reloads after a single isolated change, just delayed by the debounce window", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const plugin = _debounceNitroFullReloadHotUpdate(
        fakeNitroMainPlugin(function () {
          this.environment.hot.send({ type: "full-reload" });
        }),
      );
      const context = { environment: { name: "ssr", hot: { send } } };

      plugin.hotUpdate.call(context, { modules: [] });
      expect(send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes non full-reload hot messages through immediately, unbatched", () => {
    const send = vi.fn();
    const plugin = _debounceNitroFullReloadHotUpdate(
      fakeNitroMainPlugin(function () {
        this.environment.hot.send({ type: "custom", event: "an:ping" });
      }),
    );
    const context = { environment: { name: "ssr", hot: { send } } };

    plugin.hotUpdate.call(context, { modules: [] });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "custom", event: "an:ping" });
  });

  it("never delays module-graph invalidation, only the reload broadcast", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const invalidateModule = vi.fn();
      const plugin = _debounceNitroFullReloadHotUpdate(
        fakeNitroMainPlugin(function (options) {
          for (const mod of options.modules) {
            this.environment.moduleGraph.invalidateModule(mod);
          }
          this.environment.hot.send({ type: "full-reload" });
        }),
      );
      const context = {
        environment: {
          name: "ssr",
          hot: { send },
          moduleGraph: { invalidateModule },
        },
      };

      plugin.hotUpdate.call(context, { modules: ["a.ts", "b.ts"] });

      expect(invalidateModule).toHaveBeenCalledTimes(2);
      expect(invalidateModule).toHaveBeenCalledWith("a.ts");
      expect(invalidateModule).toHaveBeenCalledWith("b.ts");
      // The reload itself is still debounced.
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps debounce timers independent per Vite environment", () => {
    vi.useFakeTimers();
    try {
      const sendSsr = vi.fn();
      const sendWorker = vi.fn();
      const plugin = _debounceNitroFullReloadHotUpdate(
        fakeNitroMainPlugin(function () {
          this.environment.hot.send({ type: "full-reload" });
        }),
      );

      plugin.hotUpdate.call(
        { environment: { name: "ssr", hot: { send: sendSsr } } },
        { modules: [] },
      );
      vi.advanceTimersByTime(150);
      plugin.hotUpdate.call(
        { environment: { name: "worker", hot: { send: sendWorker } } },
        { modules: [] },
      );

      // 300ms after the "ssr" call, but only 150ms after "worker"'s call.
      vi.advanceTimersByTime(150);
      expect(sendSsr).toHaveBeenCalledTimes(1);
      expect(sendWorker).not.toHaveBeenCalled();

      vi.advanceTimersByTime(150);
      expect(sendWorker).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports object-form ({ handler }) hotUpdate hooks", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const handler = vi.fn(function (this: { environment: any }) {
        this.environment.hot.send({ type: "full-reload" });
      });
      const plugin = _debounceNitroFullReloadHotUpdate({
        name: "nitro:main",
        hotUpdate: { order: "post", handler },
      } as any);
      const context = { environment: { name: "ssr", hot: { send } } };

      expect((plugin.hotUpdate as any).order).toBe("post");
      (plugin.hotUpdate as any).handler.call(context, { modules: [] });
      vi.advanceTimersByTime(300);

      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves plugins without a hotUpdate hook unchanged", () => {
    const plugin = { name: "nitro:env" } as any;
    expect(_debounceNitroFullReloadHotUpdate(plugin)).toBe(plugin);
  });
});

describe("Vite CSS build defaults", () => {
  it("keeps standard backdrop-filter declarations in production CSS", () => {
    const config = defineConfig();

    expect(config.build).toMatchObject({
      cssMinify: "esbuild",
      cssTarget: ["es2020", "safari18"],
    });
  });
});

describe("Vite SSR stubs", () => {
  it("exports common browser-only names from the generated stub module", async () => {
    const plugins = (defineConfig({ ssrStubs: ["yjs"] }).plugins ?? [])
      .flat()
      .filter(Boolean) as any[];
    const plugin = plugins.find(
      (entry) => entry?.name === "agent-native-ssr-stub-heavy-libs",
    );

    expect(plugin).toBeDefined();
    expect(await plugin.resolveId("yjs", undefined, { ssr: true })).toBe(
      "\0agent-native-ssr-stub",
    );
    expect(
      await plugin.resolveId("react", undefined, { ssr: true }),
    ).toBeNull();
    expect(await plugin.resolveId("yjs", undefined, { ssr: false })).toBeNull();

    const code = await plugin.load("\0agent-native-ssr-stub");
    expect(code).toContain("export const Doc = stub;");
    expect(code).toContain("export const Map = stub;");
    expect(code).toContain("export const encodeStateVector = stub;");
    expect(code).toContain("export const encodeStateAsUpdate = stub;");
    expect(code).toContain("export const mergeUpdates = stub;");
    expect(code).toContain("export const EditorContent = stub;");
    expect(code).toContain("export const createNodeFromContent = stub;");
    expect(code).toContain("export const format = stub;");
    expect(code).toContain("export const useMessagePartReasoning = stub;");
  });
});

describe("local-core dev aliases and router dedupe", () => {
  it("dedupes react-router when the app depends on react-router", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-dedupe-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { "react-router": "^8.0.1" },
      }),
    );

    const dedupe = _getClientDedupe(tmpDir);
    expect(dedupe).toContain("react-router");
    expect(dedupe).toContain("react-router/dom");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pre-optimizes core client deps when core is source-aliased", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-optimize-"));
    const coreRoot = path.resolve(import.meta.dirname, "../..");
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/core": pathToFileURL(coreRoot).href,
          "@paper-design/shaders-react": "0.0.76",
          html2canvas: "^1.4.1",
          "react-router": "^8.0.1",
        },
      }),
    );

    const deps = _getDefaultOptimizeDeps(tmpDir);
    expect(deps).not.toContain("@agent-native/core/client");
    expect(deps).not.toContain("@agent-native/core/client/i18n");
    expect(deps).toContain("@agent-native/core > @assistant-ui/react");
    expect(deps).toContain("@agent-native/core > @codemirror/lang-sql");
    expect(deps).toContain("@agent-native/core > @sentry/browser");
    expect(deps).toContain(
      "@agent-native/core > @shadcn/react/message-scroller",
    );
    expect(deps).toContain("@agent-native/core > @tiptap/react");
    expect(deps).toContain("@agent-native/core > @uiw/react-codemirror");
    expect(deps).toContain("@agent-native/core > @xterm/xterm");
    expect(deps).toContain("@agent-native/core > i18next");
    expect(deps).toContain("@agent-native/core > react-i18next");
    expect(deps).toContain("@agent-native/core > shiki/core");
    expect(deps).toContain("@paper-design/shaders-react");
    expect(deps).not.toContain(
      "@agent-native/core > @paper-design/shaders-react",
    );
    expect(deps).toContain("html2canvas");
    expect(deps).not.toContain("@agent-native/core > html2canvas");
    expect(deps).toContain("react-router");
    expect(deps).not.toContain("@agent-native/core > react-router");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pre-optimizes the i18n subpath for published core consumers", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-vite-optimize-i18n-"),
    );
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/core": "^0.88.0",
          "@agent-native/toolkit": "^0.4.0",
        },
      }),
    );

    const deps = _getDefaultOptimizeDeps(tmpDir);
    expect(deps).toContain("@agent-native/core/client/i18n");
    expect(deps).toContain("@agent-native/toolkit/collab-ui");
    expect(deps).toContain("@agent-native/toolkit/sharing");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes and aliases the i18n subpath when local core source is active", () => {
    const previousCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-i18n-src-"));
    const appDir = path.join(tmpDir, "templates", "dispatch");
    const coreSrcDir = path.join(tmpDir, "packages", "core", "src");
    fs.mkdirSync(path.join(coreSrcDir, "client"), { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "package.json"), "{}");
    fs.writeFileSync(path.join(coreSrcDir, "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(coreSrcDir, "client", "i18n.tsx"), "\n");

    try {
      process.chdir(appDir);
      const config = defineConfig();
      const exclude =
        (config.optimizeDeps as { exclude?: string[] } | undefined)?.exclude ??
        [];
      const aliases =
        (
          config.resolve as {
            alias?: Array<{ find: RegExp; replacement: string }>;
          }
        )?.alias ?? [];

      expect(exclude).toContain("@agent-native/core/client/i18n");
      expect(
        aliases.some(
          (alias) =>
            alias.find.test("@agent-native/core/client/i18n") &&
            alias.replacement.endsWith("src/client/i18n.tsx"),
        ),
      ).toBe(true);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not pre-optimize packages that are only optional core peers", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-vite-optimize-peer-"),
    );
    const fakeCore = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-vite-fake-core-"),
    );
    fs.mkdirSync(path.join(fakeCore, "src"));
    fs.writeFileSync(path.join(fakeCore, "src/index.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(fakeCore, "package.json"),
      JSON.stringify({
        name: "@agent-native/core",
        peerDependencies: {
          sonner: "^2.0.0",
        },
        peerDependenciesMeta: {
          sonner: { optional: true },
        },
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/core": pathToFileURL(fakeCore).href,
        },
      }),
    );

    const deps = _getDefaultOptimizeDeps(tmpDir);
    expect(deps).not.toContain("sonner");

    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeCore, { recursive: true, force: true });
  });

  it("keeps react-router inside the dev SSR graph so dedupe applies", () => {
    const previousCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-ssr-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "react-router": "^8.0.1",
        },
      }),
    );

    try {
      process.chdir(tmpDir);
      const ssr = defineConfig().ssr as {
        noExternal?: unknown[];
        external?: string[];
      };
      const noExternal = ssr.noExternal ?? [];
      const external = ssr.external ?? [];
      const routerNoExternal = noExternal.find(
        (entry) =>
          entry instanceof RegExp &&
          entry.test("react-router") &&
          entry.test("react-router/dom") &&
          !entry.test("react-router-extra"),
      );

      expect(routerNoExternal).toBeDefined();
      expect(external).not.toContain("react-router");
      expect(external).not.toContain("react-router/dom");
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("allows workspace-root node_modules for monorepo template assets", () => {
    const previousCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-fs-allow-"));
    const appDir = path.join(tmpDir, "templates", "forms");
    const nodeModulesDir = path.join(tmpDir, "node_modules");
    const coreDir = path.join(tmpDir, "packages", "core");
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, "package.json"), "{}");

    try {
      process.chdir(appDir);
      const config = defineConfig();
      const fsAllow =
        (config.server as { fs?: { allow?: string[] } } | undefined)?.fs
          ?.allow ?? [];

      expect(fsAllow).toContain(
        fs.realpathSync(path.join(tmpDir, "packages", "core")),
      );
      expect(fsAllow).toContain(fs.realpathSync(nodeModulesDir));
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves file:@agent-native/core to a package root with src/index.ts", () => {
    const coreRoot = path.resolve(import.meta.dirname, "../..");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-core-root-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/core": pathToFileURL(coreRoot).href,
        },
      }),
    );

    expect(_findCorePackageRoot(tmpDir)).toBe(coreRoot);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("aliases file:@agent-native/toolkit conditional exports to source", () => {
    const previousCwd = process.cwd();
    const toolkitRoot = path.resolve(
      import.meta.dirname,
      "../../..",
      "toolkit",
    );
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vite-toolkit-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/toolkit": pathToFileURL(toolkitRoot).href,
        },
      }),
    );

    try {
      process.chdir(tmpDir);
      const aliases =
        (
          defineConfig().resolve as {
            alias?: Array<{ find: RegExp; replacement: string }>;
          }
        )?.alias ?? [];
      const collabAlias = aliases.find((alias) =>
        alias.find.test("@agent-native/toolkit/collab-ui"),
      );
      const buttonAlias = aliases.find((alias) =>
        alias.find.test("@agent-native/toolkit/ui/button"),
      );

      expect(collabAlias?.replacement).toBe(
        path.join(toolkitRoot, "src/collab-ui/index.ts"),
      );
      expect(buttonAlias?.replacement).toBe(
        path.join(toolkitRoot, "src/ui/$1"),
      );
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("source-aliases workspace package dependencies during app builds", () => {
    const previousCwd = process.cwd();
    const toolkitRoot = path.resolve(
      import.meta.dirname,
      "../../..",
      "toolkit",
    );
    const workspaceRoot = path.resolve(import.meta.dirname, "../../../..");
    const tmpDir = fs.mkdtempSync(
      path.join(workspaceRoot, ".tmp-an-vite-workspace-"),
    );
    const appDir = path.join(tmpDir, "test-app");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@agent-native/pinpoint": "workspace:*",
          "@agent-native/toolkit": "workspace:*",
        },
      }),
    );

    try {
      process.chdir(appDir);
      const aliases =
        (
          defineConfig().resolve as {
            alias?: Array<{ find: RegExp; replacement: string }>;
          }
        )?.alias ?? [];

      const popoverAlias = aliases.find((alias) =>
        alias.find instanceof RegExp
          ? alias.find.test("@agent-native/toolkit/ui/popover")
          : alias.find === "@agent-native/toolkit/ui/popover",
      );

      expect(popoverAlias?.replacement).toBe(
        path.join(toolkitRoot, "src/ui/$1"),
      );
      expect(
        aliases.some((alias) =>
          alias.find instanceof RegExp
            ? alias.find.test("@agent-native/pinpoint/react")
            : alias.find === "@agent-native/pinpoint/react",
        ),
      ).toBe(false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("aliases react-router to the consuming app install", () => {
    const coreRoot = path.resolve(import.meta.dirname, "../..");
    const aliases = _getReactRouterAliases(coreRoot);
    expect(aliases).toHaveLength(2);
    expect(aliases[0]?.find.test("react-router/dom")).toBe(true);
    expect(fs.existsSync(aliases[0]!.replacement)).toBe(true);
    expect(aliases[1]?.find.test("react-router")).toBe(true);
    expect(fs.existsSync(aliases[1]!.replacement)).toBe(true);
  });
});
