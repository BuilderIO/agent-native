import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkGoogleOAuthPreflight,
  clearGoogleOAuthPreflightCache,
} from "./google-oauth-preflight.js";

/** Base64 of the protobuf payload Google puts in `authError`. */
function authError(code: string, message = "Something went wrong."): string {
  const body = `\n${String.fromCharCode(code.length)}${code}\u0012${String.fromCharCode(message.length)}${message}`;
  return Buffer.from(body, "utf8").toString("base64");
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

const INPUT = {
  clientId: "test-client.apps.googleusercontent.com",
  redirectUri: "https://beta.slides.example.com/_agent-native/google/callback",
  scopes: ["openid", "https://www.googleapis.com/auth/drive.file"],
};

describe("checkGoogleOAuthPreflight", () => {
  beforeEach(() => {
    clearGoogleOAuthPreflightCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the sign-in redirect Google returns for a valid request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        redirectTo("https://accounts.google.com/v3/signin/identifier?o2v=2"),
      ),
    );
    await expect(checkGoogleOAuthPreflight(INPUT)).resolves.toEqual({
      status: "ok",
    });
  });

  it("reports the unregistered redirect URI the beta report hit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        redirectTo(
          `https://accounts.google.com/signin/oauth/error?authError=${authError("redirect_uri_mismatch")}`,
        ),
      ),
    );
    await expect(checkGoogleOAuthPreflight(INPUT)).resolves.toEqual({
      status: "rejected",
      code: "redirect_uri_mismatch",
    });
  });

  it("reports a deleted or unknown OAuth client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        redirectTo(
          `https://accounts.google.com/signin/oauth/error?authError=${authError("invalid_client", "The OAuth client was not found.")}`,
        ),
      ),
    );
    await expect(checkGoogleOAuthPreflight(INPUT)).resolves.toMatchObject({
      status: "rejected",
      code: "invalid_client",
    });
  });

  it("still reports a rejection when the error code is unrecognized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        redirectTo(
          `https://accounts.google.com/signin/oauth/error?authError=${authError("some_future_code")}`,
        ),
      ),
    );
    await expect(checkGoogleOAuthPreflight(INPUT)).resolves.toEqual({
      status: "rejected",
      code: "unrecognized",
    });
  });

  it("separates an unreachable probe from a passing one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await checkGoogleOAuthPreflight(INPUT);
    expect(result.status).toBe("unknown");
    expect(result).not.toMatchObject({ status: "ok" });
  });

  it("does not treat a non-redirect response as a pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(checkGoogleOAuthPreflight(INPUT)).resolves.toMatchObject({
      status: "unknown",
    });
  });

  it("caches a verdict so the editor load path costs one probe per TTL", async () => {
    const fetchMock = vi.fn(async () =>
      redirectTo("https://accounts.google.com/v3/signin/identifier"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await checkGoogleOAuthPreflight(INPUT);
    await checkGoogleOAuthPreflight(INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
