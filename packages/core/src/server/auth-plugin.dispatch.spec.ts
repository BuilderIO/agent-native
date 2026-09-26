import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoMountAuth: vi.fn(),
  getSession: vi.fn(),
  runBetterAuthMigrations: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  autoMountAuth: mocks.autoMountAuth,
  getSession: mocks.getSession,
}));
vi.mock("./better-auth-migrations.js", () => ({
  runBetterAuthMigrations: mocks.runBetterAuthMigrations,
}));
vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { createAuthPlugin } from "./auth-plugin.js";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, pathname: string) {
  const url = new URL(`http://example.test${pathname}`);
  const event = {
    method: "GET",
    url,
    path: pathname,
    context: {},
    req: new Request(url, { method: "GET" }),
    res: { status: 200, headers: new Headers() },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  return next();
}

describe("createAuthPlugin dispatch: no 404 window while the mount is pending", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("holds a request to /_agent-native/auth/session until Better Auth mounts, then dispatches to the registered handler", async () => {
    const nitroApp = createNitroApp();
    mocks.runBetterAuthMigrations.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ ok: true });
    let resolveMount!: () => void;
    mocks.autoMountAuth.mockImplementation(async (app: any) => {
      await new Promise<void>((resolve) => {
        resolveMount = resolve;
      });
      app.use("/_agent-native/auth/session", () => ({ ok: true }));
      return true;
    });

    createAuthPlugin()(nitroApp);

    let settled = false;
    const pending = dispatch(nitroApp, "/_agent-native/auth/session").then(
      (result) => {
        settled = true;
        return result;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveMount();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(settled).toBe(true);
  });

  it("holds a request to a BYOA session route the same way", async () => {
    const nitroApp = createNitroApp();
    let resolveMount!: (value: boolean) => void;
    mocks.autoMountAuth.mockImplementation(async (app: any) => {
      await new Promise<boolean>((resolve) => {
        resolveMount = resolve;
      });
      app.use("/_agent-native/auth/session", () => ({ ok: true }));
      return true;
    });

    createAuthPlugin({ getSession: vi.fn() })(nitroApp);

    let settled = false;
    const pending = dispatch(nitroApp, "/_agent-native/auth/session").then(
      (result) => {
        settled = true;
        return result;
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveMount(true);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(settled).toBe(true);
  });

  it("still does not wait on the unrelated default-plugin bootstrap once mounted", async () => {
    const nitroApp = createNitroApp();
    mocks.runBetterAuthMigrations.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({ ok: true });
    mocks.autoMountAuth.mockImplementation(async (app: any) => {
      app.use("/_agent-native/auth/session", () => ({ ok: true }));
      return true;
    });

    createAuthPlugin()(nitroApp);

    await expect(
      dispatch(nitroApp, "/_agent-native/auth/session"),
    ).resolves.toEqual({ ok: true });
  });
});
