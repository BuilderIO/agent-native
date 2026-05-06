import { describe, expect, it, vi } from "vitest";
import {
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

describe("dev server mounted path helpers", () => {
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
