import { describe, it, expect, beforeEach, vi } from "vitest";

import { registerErrorCaptureProvider } from "./capture-error.js";
import { encodeMagicLinkSignupAttribution } from "./magic-link-attribution.js";

const tracked: Array<{
  name: string;
  properties: Record<string, unknown>;
  source?: { userId?: string; anonymousId?: string };
}> = [];

vi.mock("../tracking/index.js", () => ({
  track: (
    name: string,
    properties: Record<string, unknown>,
    source?: { userId?: string; anonymousId?: string },
  ) => {
    tracked.push({ name, properties, source });
  },
  identify: () => {},
  flushTracking: async () => {},
}));

const AUTH_SECRET = "test-secret-for-magic-link-attribution";
vi.mock("./app-url.js", () => ({ getAppProductionUrl: () => undefined }));

const persisted: Array<{
  userId: string;
  attribution: Record<string, string | undefined> | undefined;
}> = [];
let persistError: Error | undefined;
vi.mock("./user-first-touch-attribution.js", () => ({
  persistUserFirstTouchAttribution: async (
    userId: string,
    attribution: Record<string, string | undefined> | undefined,
  ) => {
    if (persistError) throw persistError;
    persisted.push({ userId, attribution });
    return true;
  },
}));

let requestContext: Record<string, unknown> | undefined;
vi.mock("./request-context.js", () => ({
  getRequestContext: () => requestContext,
  hasContinuationLocalRequestContext: () => true,
  runWithRequestContext: (ctx: Record<string, unknown>, fn: () => unknown) =>
    fn(),
}));

const { emitSignupEventForCreatedUser, getAuthSecret } =
  await import("./better-auth-instance.js");

const USER = { id: "user_1", email: "new@example.com", name: "New" };

function firstTouchCookie(value: Record<string, string>): string {
  return `an_ft=${encodeURIComponent(JSON.stringify(value))}`;
}

function headersWithCookie(cookie: string): Headers {
  return new Headers({ cookie });
}

beforeEach(() => {
  tracked.length = 0;
  persisted.length = 0;
  persistError = undefined;
  requestContext = undefined;
  process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
});

describe("emitSignupEventForCreatedUser", () => {
  it("emits an attributed signup for a browser that reached an endpoint", async () => {
    await emitSignupEventForCreatedUser(USER, {
      headers: headersWithCookie(
        `an_aid=anon_browser_1; ${firstTouchCookie({
          utm_source: "google",
          utm_campaign: "launch",
          landing_path: "/",
        })}`,
      ),
    });

    expect(tracked).toHaveLength(1);
    expect(tracked[0].name).toBe("signup");
    expect(tracked[0].source?.anonymousId).toBe("anon_browser_1");
    expect(tracked[0].properties).toMatchObject({
      auth_provider: "better-auth",
      signup_origin: "browser_signup",
      signup_method: "password",
      utm_source: "google",
      utm_campaign: "launch",
    });
  });

  it("labels a signup created by magic-link verification", async () => {
    const headers = headersWithCookie("an_aid=anon_magic_1");
    await emitSignupEventForCreatedUser(USER, {
      request: {
        headers,
        url: "/_agent-native/auth/ba/magic-link/verify?newUserCallbackURL=%2F",
      },
    });

    expect(tracked[0]?.properties).toMatchObject({
      signup_method: "magic_link",
    });
  });

  it("emits nothing for a row created outside any request", async () => {
    await emitSignupEventForCreatedUser(USER, null);
    await emitSignupEventForCreatedUser(USER, undefined);
    await emitSignupEventForCreatedUser(USER, {});
    await emitSignupEventForCreatedUser(USER, { request: { url: "/x" } });

    expect(tracked).toEqual([]);
  });

  it("omits referral_source entirely when the request carried no cookies", async () => {
    await emitSignupEventForCreatedUser(USER, { headers: new Headers() });

    expect(tracked).toHaveLength(1);
    expect(tracked[0].properties).not.toHaveProperty("referral_source");
    expect(tracked[0].source?.anonymousId).toBeUndefined();
  });

  it("still records direct for a real visitor who arrived with no campaign", async () => {
    await emitSignupEventForCreatedUser(USER, {
      headers: headersWithCookie(
        `an_aid=anon_2; ${firstTouchCookie({ landing_path: "/" })}`,
      ),
    });

    expect(tracked[0].properties).toMatchObject({
      referral_source: "direct",
      signup_origin: "browser_signup",
    });
  });

  it("labels SSO provisioning so one person across sibling apps is not a dozen acquisitions", async () => {
    requestContext = { signupOrigin: "sso_jit" };

    await emitSignupEventForCreatedUser(USER, {
      headers: headersWithCookie("an_aid=anon_3"),
    });

    expect(tracked[0].properties).toMatchObject({ signup_origin: "sso_jit" });
  });

  it("recovers attribution from the signed magic-link token across browsers", async () => {
    const token = encodeMagicLinkSignupAttribution(
      {
        attribution: { referral_source: "external", utm_source: "newsletter" },
        anonymousId: "anon_magic_1",
      },
      getAuthSecret(),
    );
    const callback = `/_agent-native/auth/magic-link/new-user?signup_attribution=${encodeURIComponent(
      token as string,
    )}`;

    await emitSignupEventForCreatedUser(USER, {
      headers: new Headers(),
      request: {
        url: `https://app.example.com/_agent-native/auth/ba/magic-link/verify?token=t&newUserCallbackURL=${encodeURIComponent(
          callback,
        )}`,
      },
    });

    expect(tracked[0].source?.anonymousId).toBe("anon_magic_1");
    expect(tracked[0].properties).toMatchObject({ utm_source: "newsletter" });
    expect(persisted).toEqual([
      {
        userId: "user_1",
        attribution: expect.objectContaining({ utm_source: "newsletter" }),
      },
    ]);
  });

  it("persists paid first-touch parameters on the user row for a browser signup", async () => {
    await emitSignupEventForCreatedUser(USER, {
      headers: headersWithCookie(
        `an_aid=anon_paid; ${firstTouchCookie({
          utm_source: "bing",
          utm_medium: "cpc",
          utm_campaign: "slides-competitors",
          utm_term: "gamma presentations",
          msclkid: "click-1",
          vector_source: "GOOGLE",
          landing_referrer: "www.bing.com",
          landing_path: "/",
        })}`,
      ),
    });

    expect(persisted).toEqual([
      {
        userId: "user_1",
        attribution: expect.objectContaining({
          utm_source: "bing",
          utm_medium: "cpc",
          utm_campaign: "slides-competitors",
          utm_term: "gamma presentations",
          msclkid: "click-1",
          vector_source: "GOOGLE",
          landing_referrer: "www.bing.com",
        }),
      },
    ]);
  });

  it("still emits the signup, and reports the failure, when the first-touch write fails", async () => {
    persistError = new Error("column first_touch_utm_source does not exist");
    const captured = vi.fn();
    const unregister = registerErrorCaptureProvider(
      "first-touch-test",
      captured,
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        emitSignupEventForCreatedUser(USER, {
          headers: headersWithCookie(
            `an_aid=anon_paid; ${firstTouchCookie({ utm_source: "bing" })}`,
          ),
        }),
      ).resolves.toBeUndefined();

      expect(tracked).toHaveLength(1);
      expect(tracked[0].properties).toMatchObject({ utm_source: "bing" });
      expect(log).toHaveBeenCalledWith(
        "[auth] failed to persist signup attribution",
        persistError,
      );
      expect(captured).toHaveBeenCalledWith(
        persistError,
        expect.objectContaining({
          tags: expect.objectContaining({
            failureClass: "signup-attribution-persist",
          }),
        }),
      );
    } finally {
      unregister();
      log.mockRestore();
    }
  });

  it("does not copy another signed-in user's first touch onto an account they create", async () => {
    const headers = headersWithCookie(
      `an_aid=anon_admin; ${firstTouchCookie({ utm_source: "admin-campaign" })}`,
    );

    await emitSignupEventForCreatedUser(USER, {
      headers,
      context: { session: { user: { id: "admin_1" } } },
    });
    expect(persisted).toEqual([]);
    expect(tracked).toHaveLength(1);

    await emitSignupEventForCreatedUser(USER, {
      headers,
      context: { session: { user: { id: USER.id } } },
    });
    expect(persisted).toHaveLength(1);
  });

  it("persists nothing for a row created with no browser attribution", async () => {
    await emitSignupEventForCreatedUser(USER, { headers: new Headers() });
    await emitSignupEventForCreatedUser(USER, null);

    expect(persisted).toEqual([]);
  });

  // The handoff header is unsigned and outranks the cookie, so a request that
  // arrives carrying one must not be able to author somebody's attribution.
  it("prefers the request-scoped context over an inbound handoff header", async () => {
    requestContext = {
      signupAttribution: {
        attribution: { utm_source: "real" },
        anonymousId: "anon_real",
      },
    };

    await emitSignupEventForCreatedUser(USER, {
      headers: new Headers({
        "x-agent-native-signup-attribution": encodeURIComponent(
          JSON.stringify({
            attribution: { utm_source: "spoofed" },
            anonymousId: "anon_spoofed",
          }),
        ),
      }),
    });

    expect(tracked[0].source?.anonymousId).toBe("anon_real");
    expect(tracked[0].properties).toMatchObject({ utm_source: "real" });
  });
});
