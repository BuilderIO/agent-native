import { createApp, defineEventHandler } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));

import {
  hasUiActionCapability,
  mountUiActionCapabilityRoute,
} from "./ui-action-capability.js";

describe("UI action capability", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-ui-capability-secret");
    vi.stubEnv("OAUTH_STATE_SECRET", "test-ui-capability-secret");
    mockGetSession.mockResolvedValue({ email: "Alice@example.com" });
  });

  afterEach(() => {
    mockGetSession.mockReset();
    vi.unstubAllEnvs();
  });

  it("mints an owner-bound HttpOnly capability and rejects tampering", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const mint = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability"),
    );

    expect(mint.status).toBe(200);
    expect(mint.headers.get("cache-control")).toBe("no-store");
    const setCookie = mint.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Path=/_agent-native/actions");
    const cookie = setCookie.split(";", 1)[0];
    expect(cookie).toMatch(/^agent-native-ui-capability=\S+$/);

    app.use(
      "/verify",
      defineEventHandler((event) => ({
        exact: hasUiActionCapability(event, "alice@example.com"),
        mismatch: hasUiActionCapability(event, "other@example.com"),
        tampered: hasUiActionCapability(
          {
            ...event,
            req: {
              ...event.req,
              headers: new Headers({
                cookie: `${cookie}tampered`,
              }),
            },
          } as typeof event,
          "alice@example.com",
        ),
      })),
    );

    const verify = await app.fetch(
      new Request("https://example.test/verify", {
        headers: { cookie },
      }),
    );

    expect(await verify.json()).toEqual({
      exact: true,
      mismatch: false,
      tampered: false,
    });
  });

  it("uses the built app base path for the capability cookie", async () => {
    const app = createApp();
    mountUiActionCapabilityRoute(app, "/_agent-native", "/docs");

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability"),
    );

    expect(response.headers.get("set-cookie")).toContain(
      "Path=/docs/_agent-native/actions",
    );
  });

  it("does not mint a capability without an authenticated session", async () => {
    mockGetSession.mockResolvedValue(null);
    const app = createApp();
    mountUiActionCapabilityRoute(app);

    const response = await app.fetch(
      new Request("https://example.test/_agent-native/ui-capability"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });
});
