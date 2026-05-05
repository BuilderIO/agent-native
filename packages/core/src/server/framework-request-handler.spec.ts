import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getH3App,
  markDefaultPluginProvided,
} from "./framework-request-handler.js";
import { getMissingDefaultPlugins } from "../deploy/route-discovery.js";

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
    getH3App(nitroApp).use("/_agent-native/extensions", (event: any) => ({
      mountPrefix: event.context._mountPrefix,
      mountedPathname: event.context._mountedPathname,
      pathname: event.url.pathname,
    }));

    await expect(
      dispatch(nitroApp, "/_agent-native/extensions/extension-1/render"),
    ).resolves.toEqual({
      mountPrefix: "/_agent-native/extensions",
      mountedPathname: "/_agent-native/extensions/extension-1/render",
      pathname: "/extension-1/render",
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

  it("dispatches well-known routes under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/starter";
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/.well-known/agent-card.json", (event: any) => ({
      mountPrefix: event.context._mountPrefix,
      mountedPathname: event.context._mountedPathname,
      pathname: event.url.pathname,
      path: event.path,
    }));

    await expect(
      dispatch(nitroApp, "/starter/.well-known/agent-card.json"),
    ).resolves.toEqual({
      mountPrefix: "/starter/.well-known/agent-card.json",
      mountedPathname: "/starter/.well-known/agent-card.json",
      pathname: "/",
      path: "/",
    });
  });

  it("waits for default plugin bootstrap before app-scoped well-known routes fall through", async () => {
    process.env.APP_BASE_PATH = "/starter";
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nitroApp = createNitroApp();
    vi.mocked(getMissingDefaultPlugins).mockImplementationOnce(async () => {
      await ready;
      getH3App(nitroApp).use("/.well-known/agent-card.json", () => ({
        ok: true,
      }));
      return [];
    });

    getH3App(nitroApp);
    const pending = dispatch(nitroApp, "/starter/.well-known/agent-card.json");
    await Promise.resolve();

    release();

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("does not auto-mount a default plugin slot marked as provided at runtime", async () => {
    const nitroApp = createNitroApp();
    markDefaultPluginProvided(nitroApp, "agent-chat");
    vi.mocked(getMissingDefaultPlugins).mockResolvedValueOnce(["agent-chat"]);

    getH3App(nitroApp);

    await expect(
      dispatch(nitroApp, "/.well-known/agent-card.json"),
    ).resolves.toEqual({ fellThrough: true });
  });

  it("does not treat similar non-prefixed paths as framework routes", async () => {
    process.env.APP_BASE_PATH = "/docs";
    const nitroApp = createNitroApp();
    getH3App(nitroApp).use("/_agent-native/extensions", () => ({
      matched: true,
    }));

    await expect(
      dispatch(nitroApp, "/docs-extra/_agent-native/extensions"),
    ).resolves.toEqual({ fellThrough: true });
  });
});
