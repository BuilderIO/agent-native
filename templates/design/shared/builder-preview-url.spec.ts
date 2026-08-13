import { afterEach, describe, expect, it } from "vitest";

import {
  InvalidBuilderPreviewUrlError,
  isBuilderPreviewUrl,
  parseBuilderPreviewUrl,
} from "./builder-preview-url.js";

describe("parseBuilderPreviewUrl", () => {
  it("accepts every Builder preview host family over https", () => {
    for (const url of [
      "https://my-app.fly.dev/",
      "https://branch-x.builderio.xyz/dashboard",
      "https://branch-x.builderio.dev/",
      "https://thing.builder.codes/",
      "https://thing.builder.my/",
      "https://thing.builder.live/",
      "https://deep.nested.sub.builderio.xyz/a/b?c=1#d",
    ]) {
      expect(isBuilderPreviewUrl(url), url).toBe(true);
    }
  });

  it("accepts loopback over http for local containers", () => {
    expect(isBuilderPreviewUrl("http://localhost:5173/")).toBe(true);
    expect(isBuilderPreviewUrl("http://127.0.0.1:8080/app")).toBe(true);
  });

  it("rejects http on non-loopback hosts", () => {
    expect(() => parseBuilderPreviewUrl("http://x.builderio.xyz/")).toThrow(
      InvalidBuilderPreviewUrlError,
    );
  });

  it("rejects hosts outside the allowlist", () => {
    for (const url of [
      "https://evil.com/",
      "https://builder.io/",
      "https://internal.corp/",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/",
    ]) {
      expect(isBuilderPreviewUrl(url), url).toBe(false);
    }
  });

  it("rejects lookalike hosts that merely end with the bare suffix", () => {
    for (const url of [
      "https://fly.dev/",
      "https://evilfly.dev/",
      "https://builderio.xyz/",
      "https://notbuilderio.xyz/",
      "https://x.builderio.xyz.evil.com/",
    ]) {
      expect(isBuilderPreviewUrl(url), url).toBe(false);
    }
  });

  it("rejects non-http protocols", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "file:///etc/passwd",
      "ftp://x.builderio.xyz/",
    ]) {
      expect(isBuilderPreviewUrl(url), url).toBe(false);
    }
  });

  it("rejects embedded credentials", () => {
    expect(isBuilderPreviewUrl("https://user:pw@x.builderio.xyz/")).toBe(false);
    expect(isBuilderPreviewUrl("https://user@x.builderio.xyz/")).toBe(false);
  });

  it("rejects absent, blank, and non-string input", () => {
    for (const value of [undefined, null, "", "   ", 42, {}, []]) {
      expect(isBuilderPreviewUrl(value), String(value)).toBe(false);
    }
  });

  it("names the reason rather than returning a usable-looking value", () => {
    expect(() => parseBuilderPreviewUrl("https://evil.com/")).toThrow(
      /not a recognized Builder preview host/,
    );
    expect(() => parseBuilderPreviewUrl("")).toThrow(/non-empty string/);
  });

  it("normalizes to an origin the caller can build screens against", () => {
    expect(
      parseBuilderPreviewUrl("  https://x.builderio.xyz/a?b=1  ").origin,
    ).toBe("https://x.builderio.xyz");
    expect(parseBuilderPreviewUrl("http://localhost:5173/app").origin).toBe(
      "http://localhost:5173",
    );
  });
});

describe("loopback outside development", () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it("refuses a loopback preview host in production", () => {
    process.env.NODE_ENV = "production";
    // The proxy fetches this server-side, so allowing it would scan the
    // Design host on a caller's behalf.
    expect(isBuilderPreviewUrl("http://localhost:6379/")).toBe(false);
    expect(isBuilderPreviewUrl("http://127.0.0.1:8080/")).toBe(false);
    expect(isBuilderPreviewUrl("https://[::1]/")).toBe(false);
  });

  it("still accepts a real Builder preview host in production", () => {
    process.env.NODE_ENV = "production";
    expect(isBuilderPreviewUrl("https://app.fly.dev/")).toBe(true);
  });
});
