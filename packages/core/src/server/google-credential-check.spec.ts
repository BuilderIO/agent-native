import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkGoogleSignInCredential,
  resetGoogleCredentialCheckCache,
} from "./google-credential-check.js";

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
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
    resetGoogleCredentialCheckCache();
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
});
