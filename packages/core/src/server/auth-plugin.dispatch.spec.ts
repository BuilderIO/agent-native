/**
 * Dispatch-level proof for the cold-start fix reviewed in PR #4261.
 *
 * `auth-plugin.spec.ts` mocks `framework-request-handler.js` to assert call
 * order in isolation. This file runs the REAL readiness-gate/placeholder
 * machinery from `framework-request-handler.ts` (same harness pattern as
 * `framework-request-handler.spec.ts`) against the real `createAuthPlugin`,
 * mocking only `auth.js` and `better-auth-migrations.js` so the Better Auth
 * mount itself is controllable. It proves the specific concern the review
 * raised: marking `FRAMEWORK_AUTH_EARLY_PATHS` ready before the mount
 * promise resolves does not open a window where a request falls through to
 * a 404 before Better Auth's handler is registered.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoMountAuth: vi.fn(),
  runBetterAuthMigrations: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  autoMountAuth: mocks.autoMountAuth,
}));
vi.mock("./better-auth-migrations.js", () => ({
  runBetterAuthMigrations: mocks.runBetterAuthMigrations,
}));
// getH3App's first call kicks off default-plugin bootstrap discovery — keep
// it a no-op so this file exercises only the auth mount's own gating.
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
    let resolveMount!: () => void;
    mocks.autoMountAuth.mockImplementation(async (app: any) => {
      await new Promise<void>((resolve) => {
        resolveMount = resolve;
      });
      // What the real mountBetterAuthRoutes does once init finishes.
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

    // Give the readiness gate's microtask chain room to run without the
    // mount resolving — this is the exact window the review flagged.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveMount();

    // Not `{ fellThrough: true }` — the handler autoMountAuth registered.
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
    // Companion assertion: the fix this file guards must not regress back
    // into the original cold-start bug either. getMissingDefaultPlugins is
    // mocked to resolve immediately above; a fast mount must dispatch fast.
    const nitroApp = createNitroApp();
    mocks.runBetterAuthMigrations.mockResolvedValue(undefined);
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
