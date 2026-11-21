import { afterEach, describe, expect, it, vi } from "vitest";

import { appendSessionToOAuthReturnUrl } from "./oauth-return-url.js";

const PREVIEW = "https://abc123-example.builderio.xyz/dispatch?x=1";

describe("appendSessionToOAuthReturnUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends the session to a Builder preview origin in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const url = new URL(appendSessionToOAuthReturnUrl(PREVIEW, "tok"));
    expect(url.origin).toBe("https://abc123-example.builderio.xyz");
    expect(url.searchParams.get("_session")).toBe("tok");
  });

  it("does not append the session to a Builder preview origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = appendSessionToOAuthReturnUrl(PREVIEW, "tok");
    expect(result).toBe("/");
    expect(result).not.toContain("_session");
  });

  it("still appends the session for the default loopback origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const url = new URL(
      appendSessionToOAuthReturnUrl("http://127.0.0.1:8080/app", "tok"),
    );
    expect(url.searchParams.get("_session")).toBe("tok");
  });
});
