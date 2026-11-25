import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeOAuthState,
  decodeNetlifyPreviewGoogleOAuthRelayState,
  encodeOAuthState,
  encodeNetlifyPreviewGoogleOAuthRelayState,
  AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV,
  getOAuthStateSigningKey,
  isNetlifyPreviewGoogleOAuthCallbackUrl,
  NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX,
  logOAuthStateDecodeFailure,
  OAUTH_STATE_MAX_AGE_SECONDS,
  oauthCallbackOwner,
  resolveOAuthOwner,
} from "./google-oauth.js";

const sessionMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("./auth.js", () => sessionMock);

const FALLBACK_URI = "https://app.example.com/_agent-native/google/callback";

function signRawState(data: string): string {
  const sig = crypto
    .createHmac("sha256", getOAuthStateSigningKey())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

describe("OAuth state lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a state used after the consent window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    const state = encodeOAuthState({
      redirectUri: FALLBACK_URI,
      owner: "owner@example.com",
      addAccount: true,
    });

    vi.setSystemTime(
      new Date(
        Date.parse("2026-11-18T12:00:00Z") +
          (OAUTH_STATE_MAX_AGE_SECONDS - 1) * 1000,
      ),
    );
    expect(decodeOAuthState(state, FALLBACK_URI)).toMatchObject({
      ok: true,
      owner: "owner@example.com",
    });

    vi.setSystemTime(
      new Date(
        Date.parse("2026-11-18T12:00:00Z") +
          (OAUTH_STATE_MAX_AGE_SECONDS + 1) * 1000,
      ),
    );
    expect(decodeOAuthState(state, FALLBACK_URI)).toEqual({
      ok: false,
      reason: "expired",
      redirectUri: FALLBACK_URI,
    });
  });

  it("refuses a signed state that carries no issue time", () => {
    const data = Buffer.from(
      JSON.stringify({ n: "nonce", r: FALLBACK_URI, o: "owner@example.com" }),
    ).toString("base64url");

    expect(decodeOAuthState(signRawState(data), FALLBACK_URI)).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });
});

describe("oauthCallbackOwner", () => {
  it("connects a browser callback to the session it arrives with", () => {
    // oracle-change: a differing starter now refuses the callback, covered below
    expect(
      oauthCallbackOwner("signed-in@example.com", {
        owner: "Signed-In@example.com",
      }),
    ).toBe("signed-in@example.com");
    expect(oauthCallbackOwner("signed-in@example.com", {})).toBe(
      "signed-in@example.com",
    );
    expect(
      oauthCallbackOwner(undefined, { owner: "starter@example.com" }),
    ).toBeUndefined();
  });

  it("refuses a callback whose session differs from the account that started it", () => {
    expect(
      oauthCallbackOwner("signed-in@example.com", {
        owner: "starter@example.com",
      }),
    ).toBeUndefined();
    expect(
      oauthCallbackOwner("signed-in@example.com", {
        owner: "starter@example.com",
        desktop: true,
      }),
    ).toBeUndefined();
  });

  it("falls back to the state owner only for a browser-bound desktop hand-off", () => {
    expect(
      oauthCallbackOwner(null, {
        owner: "owner@example.com",
        desktop: true,
        flowId: "flow-1",
        desktopBrowserBindingHash: "binding-hash",
      }),
    ).toBe("owner@example.com");
    // oracle-change: unbound desktop and mobile states no longer name the owner
    expect(
      oauthCallbackOwner(null, { owner: "owner@example.com", desktop: true }),
    ).toBeUndefined();
    const mobileState = { owner: "owner@example.com", mobile: true };
    expect(oauthCallbackOwner(null, mobileState)).toBeUndefined();
  });
});

describe("decodeOAuthState", () => {
  it("carries the explicit Builder signup attempt in signed OAuth state", () => {
    const state = encodeOAuthState({
      redirectUri: "https://design.example.com/callback",
      flowId: "signup-attempt-example",
      builderSignupAttemptId: "signup-attempt-example",
    });
    expect(
      decodeOAuthState(state, "https://design.example.com/callback"),
    ).toMatchObject({
      ok: true,
      flowId: "signup-attempt-example",
      builderSignupAttemptId: "signup-attempt-example",
    });
  });

  it("round-trips a valid signed state", () => {
    const signed = encodeOAuthState({
      redirectUri: "https://app.example.com/_agent-native/google/callback",
      owner: "user@example.com",
      orgId: "org_1",
      desktop: true,
      flowId: "flow-1",
    });

    const result = decodeOAuthState(signed, FALLBACK_URI);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      redirectUri: "https://app.example.com/_agent-native/google/callback",
      owner: "user@example.com",
      orgId: "org_1",
      desktop: true,
      flowId: "flow-1",
    });
  });

  it("round-trips signed state without relay metadata", () => {
    const signed = encodeOAuthState({
      redirectUri:
        "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
    });

    const result = decodeOAuthState(signed, FALLBACK_URI);

    expect(result).toMatchObject({
      ok: true,
      redirectUri:
        "https://beta.dispatch.agent-native.com/_agent-native/google/callback",
    });
    expect((result as Record<string, unknown>).relayTarget).toBeUndefined();
  });

  it("rejects a state param with no HMAC delimiter", () => {
    const result = decodeOAuthState("not-a-signed-state", FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "missing-delimiter",
      redirectUri: FALLBACK_URI,
    });
  });

  it("rejects a tampered signature", () => {
    const signed = encodeOAuthState({
      redirectUri: FALLBACK_URI,
      owner: "signed-in@example.com",
    });
    const dotIdx = signed.lastIndexOf(".");
    const data = signed.slice(0, dotIdx);
    const tampered = `${data}.${"0".repeat(43)}`;

    const result = decodeOAuthState(tampered, FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "bad-signature",
      redirectUri: FALLBACK_URI,
    });
  });

  it("rejects a payload that edits the signed data", () => {
    const signed = encodeOAuthState({
      redirectUri: FALLBACK_URI,
      owner: "signed-in@example.com",
    });
    const dotIdx = signed.lastIndexOf(".");
    const sig = signed.slice(dotIdx + 1);
    const forgedData = Buffer.from(
      JSON.stringify({ r: FALLBACK_URI, o: "starter@example.com" }),
    ).toString("base64url");

    const result = decodeOAuthState(`${forgedData}.${sig}`, FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "bad-signature",
      redirectUri: FALLBACK_URI,
    });
  });

  it("rejects a correctly-signed but corrupted (non-JSON) payload", () => {
    const data = Buffer.from("not valid json{").toString("base64url");

    const result = decodeOAuthState(signRawState(data), FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "malformed-payload",
      redirectUri: FALLBACK_URI,
    });
  });

  it("rejects corrupted base64 that decodes to invalid JSON", () => {
    const result = decodeOAuthState(
      signRawState("%%%not-base64%%%"),
      FALLBACK_URI,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed-payload");
  });

  it("rejects a missing state param", () => {
    const result = decodeOAuthState(undefined, FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "missing-state",
      redirectUri: FALLBACK_URI,
    });
  });

  it("rejects an empty-string state param the same as a missing one", () => {
    const result = decodeOAuthState("", FALLBACK_URI);

    expect(result).toEqual({
      ok: false,
      reason: "missing-state",
      redirectUri: FALLBACK_URI,
    });
  });

  it("never returns a success-shaped object for any failure reason", () => {
    const failures = [
      decodeOAuthState(undefined, FALLBACK_URI),
      decodeOAuthState("no-delimiter", FALLBACK_URI),
      decodeOAuthState(`${"a".repeat(20)}.${"b".repeat(43)}`, FALLBACK_URI),
      decodeOAuthState(
        signRawState(Buffer.from("{").toString("base64url")),
        FALLBACK_URI,
      ),
    ];

    for (const result of failures) {
      expect(result.ok).toBe(false);
      expect((result as Record<string, unknown>).owner).toBeUndefined();
      expect((result as Record<string, unknown>).desktop).toBeUndefined();
      expect((result as Record<string, unknown>).orgId).toBeUndefined();
    }
  });
});

describe("Netlify preview Google OAuth relay state", () => {
  const callbackUri =
    "https://0123456789abcdef01234567--agent-native-mail.netlify.app/_agent-native/google/callback";

  beforeEach(() => {
    vi.stubEnv(
      AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV,
      "shared-netlify-google-oauth-relay-secret-32",
    );
  });

  it("wraps a signed app state for the fixed beta callback", () => {
    const state = encodeNetlifyPreviewGoogleOAuthRelayState(
      "signed-preview-state",
      callbackUri,
      1_000,
    );

    expect(decodeNetlifyPreviewGoogleOAuthRelayState(state, 1_000)).toEqual({
      callbackUri,
      state: "signed-preview-state",
    });
  });

  it("rejects expired, mutable, and unregistered callback targets", () => {
    expect(
      decodeNetlifyPreviewGoogleOAuthRelayState(
        encodeNetlifyPreviewGoogleOAuthRelayState(
          "signed-preview-state",
          callbackUri,
          1_000,
        ),
        601_001,
      ),
    ).toBeNull();
    expect(
      isNetlifyPreviewGoogleOAuthCallbackUrl(
        "https://deploy-preview-42--agent-native-mail.netlify.app/_agent-native/google/callback",
      ),
    ).toBe(false);
    expect(() =>
      encodeNetlifyPreviewGoogleOAuthRelayState(
        "signed-preview-state",
        "https://example.com/_agent-native/google/callback",
      ),
    ).toThrow("Invalid Netlify preview Google OAuth relay state");
  });

  it("round-trips a Labs branch-alias callback and rejects hostile ones", () => {
    const labsCallback =
      "https://c-f53058ae5fc7--agent-native-labs-workspace.netlify.app/_agent-native/google/callback";
    const state = encodeNetlifyPreviewGoogleOAuthRelayState(
      "signed-preview-state",
      labsCallback,
      1_000,
    );
    expect(decodeNetlifyPreviewGoogleOAuthRelayState(state, 1_000)).toEqual({
      callbackUri: labsCallback,
      state: "signed-preview-state",
    });
    expect(isNetlifyPreviewGoogleOAuthCallbackUrl(labsCallback)).toBe(true);
    expect(
      isNetlifyPreviewGoogleOAuthCallbackUrl(
        `https://${"b".repeat(24)}--agent-native-labs-workspace.netlify.app/_agent-native/google/callback`,
      ),
    ).toBe(true);

    for (const bad of [
      "https://c-f53058ae5fc7--agent-native-other.netlify.app/_agent-native/google/callback",
      "https://c-f53058ae5fc7--agent-native-labs-workspace.netlify.app.evil.com/_agent-native/google/callback",
      "https://evil.com/c-abc123def456--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "http://c-f53058ae5fc7--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "https://user@c-f53058ae5fc7--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "https://c-f53058ae5fc7--agent-native-labs-workspace.netlify.app:8443/_agent-native/google/callback",
      "https://c-f53058ae5f--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "https://c-f53058ae5fc7a--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "https://C-F53058AE5FC7--agent-native-labs-workspace.netlify.app/_agent-native/google/callback",
      "https://c-f53058ae5fc7--agent-native-labs-workspace.netlify.app/other",
    ]) {
      expect(isNetlifyPreviewGoogleOAuthCallbackUrl(bad)).toBe(false);
      expect(() => encodeNetlifyPreviewGoogleOAuthRelayState("s", bad)).toThrow(
        "Invalid Netlify preview Google OAuth relay state",
      );
    }

    const envelope = state.slice(
      NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX.length,
    );
    const delimiter = envelope.lastIndexOf(".");
    const tampered = `${NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX}${envelope.slice(0, delimiter)}.${"A".repeat(envelope.length - delimiter - 1)}`;
    expect(
      decodeNetlifyPreviewGoogleOAuthRelayState(tampered, 1_000),
    ).toBeNull();
    expect(
      decodeNetlifyPreviewGoogleOAuthRelayState(state, 601_001),
    ).toBeNull();
  });

  it("rejects an edited expiry without the original HMAC", () => {
    const state = encodeNetlifyPreviewGoogleOAuthRelayState(
      "signed-preview-state",
      callbackUri,
      1_000,
    );
    const envelope = state.slice(
      NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX.length,
    );
    const delimiter = envelope.lastIndexOf(".");
    const encodedPayload = envelope.slice(0, delimiter);
    const signature = envelope.slice(delimiter + 1);
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    payload.e = 999_999_999;
    const editedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );

    expect(
      decodeNetlifyPreviewGoogleOAuthRelayState(
        `${NETLIFY_PREVIEW_GOOGLE_OAUTH_RELAY_STATE_PREFIX}${editedPayload}.${signature}`,
        601_001,
      ),
    ).toBeNull();
  });

  it("uses the shared relay key when deployment auth secrets differ", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "preview-auth-secret");
    const state = encodeNetlifyPreviewGoogleOAuthRelayState(
      "signed-preview-state",
      callbackUri,
      1_000,
    );

    vi.stubEnv("BETTER_AUTH_SECRET", "beta-auth-secret");

    expect(decodeNetlifyPreviewGoogleOAuthRelayState(state, 1_000)).toEqual({
      callbackUri,
      state: "signed-preview-state",
    });
  });

  it("fails closed when the shared relay key is not provisioned", () => {
    delete process.env[AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV];

    expect(() =>
      encodeNetlifyPreviewGoogleOAuthRelayState(
        "signed-preview-state",
        callbackUri,
      ),
    ).toThrow(`${AGENT_NATIVE_GOOGLE_OAUTH_RELAY_SECRET_ENV} is required`);
  });
});

describe("logOAuthStateDecodeFailure", () => {
  it("logs a structured, secret-free warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = { path: "/_agent-native/google/callback" } as any;

    logOAuthStateDecodeFailure(event, "bad-signature", "google");

    expect(warn).toHaveBeenCalledWith(
      "[agent-native][oauth] state decode failed",
      expect.objectContaining({
        reason: "bad-signature",
        provider: "google",
        path: "/_agent-native/google/callback",
      }),
    );
    warn.mockRestore();
  });
});

describe("resolveOAuthOwner", () => {
  it("refuses a callback whose session differs from the account that started it", async () => {
    sessionMock.getSession.mockResolvedValue({
      email: "signed-in@example.com",
    });

    await expect(
      resolveOAuthOwner({} as never, "starter@example.com"),
    ).rejects.toThrow(/different account/);
  });

  it("keeps the session owner when it started the flow", async () => {
    sessionMock.getSession.mockResolvedValue({
      email: "signed-in@example.com",
    });

    await expect(
      resolveOAuthOwner({} as never, "signed-in@example.com"),
    ).resolves.toEqual({
      owner: "signed-in@example.com",
      hasProductionSession: true,
    });
  });
});
