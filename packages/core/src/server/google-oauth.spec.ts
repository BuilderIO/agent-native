import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  decodeOAuthState,
  encodeOAuthState,
  getOAuthStateSigningKey,
  logOAuthStateDecodeFailure,
} from "./google-oauth.js";

const FALLBACK_URI = "https://app.example.com/_agent-native/google/callback";

/** Sign an arbitrary base64url data segment the same way encodeOAuthState
 *  does, without requiring the payload to be well-formed JSON — the only way
 *  to reach the "malformed-payload" branch, since a tampered payload fails
 *  signature verification first. */
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
    // Same payload, wrong signature — simulates a forged/tampered state or a
    // state signed under a rotated OAUTH_STATE_SECRET / BETTER_AUTH_SECRET.
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
    // Not valid base64url padding/alphabet-safe JSON once decoded.
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
      // A caller destructuring `owner`/`desktop`/`orgId` off a failed decode
      // must get `undefined`, never a value smuggled through as if this were
      // a legitimate plain sign-in.
      expect((result as Record<string, unknown>).owner).toBeUndefined();
      expect((result as Record<string, unknown>).desktop).toBeUndefined();
      expect((result as Record<string, unknown>).orgId).toBeUndefined();
    }
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
