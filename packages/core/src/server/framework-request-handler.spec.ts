import { afterEach, describe, expect, it, vi } from "vitest";
import { getH3App } from "./framework-request-handler.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, pathname: string) {
  const event = {
    method: "GET",
    url: new URL(`http://example.test${pathname}`),
    path: pathname,
    context: {},
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  return next();
}

describe("framework request handler", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.restoreAllMocks();
  });

  it("dispatches bare framework routes with a mount-relative pathname", async () => {
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/tools", (event: any) => ({
      mountPrefix: event.context._mountPrefix,
      mountedPathname: event.context._mountedPathname,
      pathname: event.url.pathname,
    }));

    await expect(
      dispatch(nitroApp, "/_agent-native/tools/tool-1/render"),
    ).resolves.toEqual({
      mountPrefix: "/_agent-native/tools",
      mountedPathname: "/_agent-native/tools/tool-1/render",
      pathname: "/tool-1/render",
    });
  });

  it("dispatches with a mount-relative event.path for legacy handlers", async () => {
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/resources", (event: any) => ({
      pathname: event.url.pathname,
      path: event.path,
    }));

    await expect(
      dispatch(nitroApp, "/_agent-native/resources/doc-1?raw=1"),
    ).resolves.toEqual({
      pathname: "/doc-1",
      path: "/doc-1?raw=1",
    });
  });

  it("restores event.path before falling through to downstream middleware", async () => {
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/resources", () => undefined);
    getH3App(nitroApp).use((event: any) => ({
      pathname: event.url.pathname,
      path: event.path,
    }));

    await expect(
      dispatch(nitroApp, "/_agent-native/resources/doc-1?raw=1"),
    ).resolves.toEqual({
      pathname: "/_agent-native/resources/doc-1",
      path: "/_agent-native/resources/doc-1?raw=1",
    });
  });

  it("dispatches framework routes under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/docs";
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/resources", (event: any) => ({
      mountPrefix: event.context._mountPrefix,
      mountedPathname: event.context._mountedPathname,
      pathname: event.url.pathname,
      path: event.path,
    }));

    await expect(
      dispatch(nitroApp, "/docs/_agent-native/resources/tree"),
    ).resolves.toEqual({
      mountPrefix: "/docs/_agent-native/resources",
      mountedPathname: "/docs/_agent-native/resources/tree",
      pathname: "/tree",
      path: "/tree",
    });
  });

  it("does not treat similar non-prefixed paths as framework routes", async () => {
    process.env.APP_BASE_PATH = "/docs";
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/tools", () => ({
      matched: true,
    }));

    await expect(
      dispatch(nitroApp, "/docs-extra/_agent-native/tools"),
    ).resolves.toEqual({ fellThrough: true });
  });
});
