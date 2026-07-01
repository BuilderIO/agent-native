import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { signEmbedSessionToken } from "../server/embed-session.js";
import {
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
    expect(code).toContain("export const format = stub;");
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
          "react-router": "^8.0.1",
        },
      }),
    );

    const deps = _getDefaultOptimizeDeps(tmpDir);
    expect(deps).not.toContain("@agent-native/core/client");
    expect(deps).toContain("@assistant-ui/react");
    expect(deps).toContain("@tiptap/react");
    expect(deps).toContain("@xterm/xterm");
    expect(deps).toContain("shiki/core");

    fs.rmSync(tmpDir, { recursive: true, force: true });
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
