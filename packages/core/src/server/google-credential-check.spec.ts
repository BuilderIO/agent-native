import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkGoogleManagedCredential,
  checkGoogleSignInCredential,
  probeGoogleRedirectUri,
  resetGoogleCredentialCheckCache,
} from "./google-credential-check.js";
import {
  recordActiveGoogleSignInCredentials,
  resetActiveGoogleSignInCredentials,
} from "./google-oauth-credentials.js";

const ENV_KEYS = [
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

function googleAnswers(error: string, status = 400) {
  return vi.fn(async () => new Response(JSON.stringify({ error }), { status }));
}

describe("checkGoogleSignInCredential", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    resetGoogleCredentialCheckCache();
    resetActiveGoogleSignInCredentials();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
    resetGoogleCredentialCheckCache();
    resetActiveGoogleSignInCredentials();
  });

  it("reads invalid_grant as a working secret", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    vi.stubGlobal("fetch", googleAnswers("invalid_grant"));

    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("valid");
    expect(result.clientId).toBe("client-a");
  });

  it("reads invalid_client as a broken secret", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "wrong";
    vi.stubGlobal("fetch", googleAnswers("invalid_client", 401));

    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("invalid_client");
  });

  it("does not report a transport failure as valid", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("valid");
  });

  it("does not cache an unknown result", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", failing);
    await checkGoogleSignInCredential();

    const recovered = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", recovered);
    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("valid");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("caches an answer Google actually gave", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    await checkGoogleSignInCredential();
    await checkGoogleSignInCredential();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates a fallback result when Better Auth publishes its active pair", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "preferred-client";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "preferred-secret";
    const initialFetch = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", initialFetch);

    const initial = await checkGoogleSignInCredential();
    expect(initial.status).toBe("valid");
    expect(initial.credentialSource).toBe("preferred");

    recordActiveGoogleSignInCredentials({
      clientId: "active-client",
      clientSecret: "active-secret",
    });
    const activeFetch = googleAnswers("invalid_client", 401);
    vi.stubGlobal("fetch", activeFetch);

    const refreshed = await checkGoogleSignInCredential();

    expect(refreshed.status).toBe("invalid");
    expect(refreshed.clientId).toBe("active-client");
    expect(refreshed.credentialSource).toBe("active");
    expect(activeFetch).toHaveBeenCalledTimes(1);
  });

  it("reports unconfigured without calling Google", async () => {
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags two credential pairs naming different clients", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    process.env.GOOGLE_CLIENT_ID = "client-b";
    process.env.GOOGLE_CLIENT_SECRET = "secret-b";
    vi.stubGlobal("fetch", googleAnswers("invalid_grant"));

    const result = await checkGoogleSignInCredential();

    // The exact shape that hid the 2026-08-20 outage: sign-in works off
    // client-a while every repair aimed at client-b changed nothing.
    expect(result.mismatchedPairs).toBe(true);
    expect(result.clientId).toBe("client-a");
  });

  it("does not flag a mismatch when only one pair is configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-b";
    process.env.GOOGLE_CLIENT_SECRET = "secret-b";
    vi.stubGlobal("fetch", googleAnswers("invalid_grant"));

    const result = await checkGoogleSignInCredential();

    expect(result.mismatchedPairs).toBe(false);
    expect(result.clientId).toBe("client-b");
  });
  it("probes the pair Better Auth actually wired, not the preferred one", async () => {
    // A scoped template (mail/calendar) runs on GOOGLE_CLIENT_*, so probing the
    // preferred GOOGLE_SIGN_IN_* pair would verify a credential the callback
    // never uses and report healthy while sign-in is broken.
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "preferred-client";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "preferred-secret";
    process.env.GOOGLE_CLIENT_ID = "scoped-client";
    process.env.GOOGLE_CLIENT_SECRET = "scoped-secret";
    recordActiveGoogleSignInCredentials({
      clientId: "scoped-client",
      clientSecret: "scoped-secret",
    });
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkGoogleSignInCredential();

    expect(result.clientId).toBe("scoped-client");
    expect(result.credentialSource).toBe("active");
    const sent = String(
      (fetchMock.mock.calls[0] as unknown[])[1] &&
        ((fetchMock.mock.calls[0] as unknown[])[1] as { body: unknown }).body,
    );
    expect(sent).toContain("scoped-secret");
    expect(sent).not.toContain("preferred-secret");
  });

  it("reports unconfigured when the wired provider had no credentials", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "preferred-client";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "preferred-secret";
    recordActiveGoogleSignInCredentials(null);
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkGoogleSignInCredential();

    expect(result.status).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes the managed workspace OAuth client separately from sign-in", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "sign-in-client";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "sign-in-secret";
    process.env.GOOGLE_CLIENT_ID = "managed-client";
    process.env.GOOGLE_CLIENT_SECRET = "managed-secret";
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkGoogleManagedCredential();

    expect(result).toMatchObject({
      status: "valid",
      clientId: "managed-client",
      credentialSource: "managed",
    });
    const sent = String(
      (fetchMock.mock.calls[0] as unknown[])[1] &&
        ((fetchMock.mock.calls[0] as unknown[])[1] as { body: unknown }).body,
    );
    expect(sent).toContain("managed-secret");
    expect(sent).not.toContain("sign-in-secret");
  });

  it("single-flights and caches definitive managed checks", async () => {
    process.env.GOOGLE_CLIENT_ID = "managed-client";
    process.env.GOOGLE_CLIENT_SECRET = "managed-secret";
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      checkGoogleManagedCredential(),
      checkGoogleManagedCredential(),
    ]);
    await checkGoogleManagedCredential();

    expect(first.status).toBe("valid");
    expect(second.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a transient managed check failure", async () => {
    process.env.GOOGLE_CLIENT_ID = "managed-client";
    process.env.GOOGLE_CLIENT_SECRET = "managed-secret";
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", failing);

    const first = await checkGoogleManagedCredential();
    const recovered = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", recovered);
    const second = await checkGoogleManagedCredential();

    expect(first.status).toBe("unknown");
    expect(second.status).toBe("valid");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("includes redirect URI status when a redirectUri is requested", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("oauth2.googleapis.com")) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://accounts.google.com/v3/signin/identifier",
          },
        });
      }),
    );

    const result = await checkGoogleSignInCredential({
      redirectUri: "https://app.example.com/_agent-native/google/callback",
    });

    expect(result.status).toBe("valid");
    expect(result.redirectUriStatus).toBe("registered");
    expect(result.redirectUri).toBe(
      "https://app.example.com/_agent-native/google/callback",
    );
  });

  it("does not probe a redirect URI when none is requested", async () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "client-a";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "secret-a";
    const fetchMock = googleAnswers("invalid_grant");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkGoogleSignInCredential();

    expect(result.redirectUriStatus).toBe("unknown");
    expect(result.redirectUri).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("probeGoogleRedirectUri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a registered redirect URI from the identifier redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: {
              location:
                "https://accounts.google.com/v3/signin/identifier?client_id=client-a",
            },
          }),
      ),
    );

    const result = await probeGoogleRedirectUri(
      "client-a",
      "https://app.example.com/_agent-native/google/callback",
    );

    expect(result.status).toBe("registered");
  });

  it("classifies a mismatched redirect URI and decodes the authError detail", async () => {
    // "redirect_uri_mismatch" base64url-encoded, matching the shape of
    // Google's opaque (protobuf, not JSON) authError param closely enough
    // for the decoded text to remain readable.
    const authError = Buffer.from("redirect_uri_mismatch", "utf-8").toString(
      "base64url",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: {
              location: `https://accounts.google.com/signin/oauth/error?authError=${authError}`,
            },
          }),
      ),
    );

    const result = await probeGoogleRedirectUri(
      "client-a",
      "https://app.example.com/_agent-native/wrong/callback",
    );

    expect(result.status).toBe("mismatched");
    expect(result.detail).toBe("redirect_uri_mismatch");
  });

  it("never coerces a network failure or timeout into registered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "TimeoutError");
      }),
    );

    const result = await probeGoogleRedirectUri(
      "client-a",
      "https://app.example.com/_agent-native/google/callback",
    );

    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("registered");
    expect(result.detail).toContain("aborted");
  });

  it("does not coerce an unrecognised redirect into registered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: {
              location: "https://accounts.google.com/some/other/page",
            },
          }),
      ),
    );

    const result = await probeGoogleRedirectUri(
      "client-a",
      "https://app.example.com/_agent-native/google/callback",
    );

    expect(result.status).toBe("unknown");
  });
});
