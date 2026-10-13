import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
} from "./google-oauth.js";

const FALLBACK_URI = "https://app.example.com/_agent-native/google/callback";

function signRawState(data: string): string {
  const sig = crypto
    .createHmac("sha256", getOAuthStateSigningKey())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

describe("decodeOAuthState", () => {
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
      owner: "victim@example.com",
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
      owner: "victim@example.com",
    });
    const dotIdx = signed.lastIndexOf(".");
    const sig = signed.slice(dotIdx + 1);
    const forgedData = Buffer.from(
      JSON.stringify({ r: FALLBACK_URI, o: "attacker@example.com" }),
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
