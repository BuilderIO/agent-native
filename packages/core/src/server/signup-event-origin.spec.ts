import { describe, it, expect, beforeEach, vi } from "vitest";

import { encodeMagicLinkSignupAttribution } from "./magic-link-attribution.js";

/**
 * The contract this file pins:
 *
 *   a `user` row insert is only a signup when a request created it.
 *
 * Better Auth calls `user.create.after` for every insert and hands it a null
 * context for anything created through `internalAdapter` outside an HTTP
 * endpoint. In production that is the legacy-session backfill and Google's
 * canonical-identity provisioning — neither of which is a person signing up.
 * Emitting for them is what put ~94% of `better-auth` signups into the
 * warehouse with no `anonymous_id` and a fabricated `referral_source: direct`.
 *
 * Every previous attempt at this bug added another attribution source to the
 * hook and shipped green, because no test ever drove the hook with the context
 * shape production actually produces. These do.
 */

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

  // The regression. `ensureGoogleAuthIdentity` and the legacy-session backfill
  // both land here with no context; each used to mint an unattributable row.
  it("emits nothing for a row created outside any request", async () => {
    await emitSignupEventForCreatedUser(USER, null);
    await emitSignupEventForCreatedUser(USER, undefined);
    await emitSignupEventForCreatedUser(USER, {});
    await emitSignupEventForCreatedUser(USER, { request: { url: "/x" } });

    expect(tracked).toEqual([]);
  });

  // "No browser" and "a browser with no campaign" must not look alike: only
  // the second one is direct traffic a marketer can act on.
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
      // No cookie: the link was opened in a different browser than the one
      // that requested it, which is the case the token exists for.
      headers: new Headers(),
      request: {
        url: `https://app.example.com/_agent-native/auth/ba/magic-link/verify?token=t&newUserCallbackURL=${encodeURIComponent(
          callback,
        )}`,
      },
    });

    expect(tracked[0].source?.anonymousId).toBe("anon_magic_1");
    expect(tracked[0].properties).toMatchObject({ utm_source: "newsletter" });
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
