import { getRequestIP, H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEmbedSessionOrigin,
  resolveEmbedRequestOrigin,
} from "./embed-request-origin.js";
import { getRequestContext, runWithRequestContext } from "./request-context.js";

function event(
  headers: HeadersInit = {},
  peer = "203.0.113.42",
  url = "https://internal.example.test/card",
) {
  const request = Object.assign(new Request(url, { headers }), {
    context: { clientAddress: peer },
  });
  return new H3Event(request);
}

afterEach(() => vi.unstubAllEnvs());

describe("embed request origin", () => {
  it("rejects an unconfigured non-loopback request authority when a public origin is configured", () => {
    vi.stubEnv("APP_URL", "https://public.example.test");
    const request = event(
      { host: "other.example.test" },
      "203.0.113.42",
      "https://other.example.test/card",
    );
    expect(() => resolveEmbedRequestOrigin(request)).toThrow(
      "Invalid embed request origin",
    );
  });

  it("accepts a configured public origin and an explicitly trusted alias", () => {
    vi.stubEnv("APP_URL", "https://public.example.test");
    vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "https://alias.example.test");
    for (const origin of [
      "https://public.example.test",
      "https://alias.example.test",
    ]) {
      expect(
        resolveEmbedRequestOrigin(event({}, "203.0.113.42", `${origin}/card`)),
      ).toBe(origin);
    }
  });

  it("checks configured authority when an older caller supplies only requestOrigin", () => {
    vi.stubEnv("APP_URL", "https://public.example.test");
    expect(() =>
      runWithRequestContext(
        { requestOrigin: "https://other.example.test" },
        getEmbedSessionOrigin,
      ),
    ).toThrow("Invalid embed request origin");
  });

  it.each([
    {
      configured: "https://public.example.test",
      headers: {
        "x-forwarded-host": "public.example.test",
        "x-forwarded-proto": "https",
      },
    },
    {
      configured: "http://internal.example.test",
      headers: {
        "x-forwarded-host": "internal.example.test",
        "x-forwarded-proto": "http",
      },
    },
  ])(
    "ignores allowlisted forwarding from a non-loopback peer: $configured",
    ({ configured, headers }) => {
      vi.stubEnv("APP_URL", "https://internal.example.test");
      vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", configured);
      const request = event(headers);
      expect(getRequestIP(request)).toBe("203.0.113.42");
      expect(resolveEmbedRequestOrigin(request)).toBe(
        "https://internal.example.test",
      );
    },
  );

  it("keeps forwarded public origin support for a loopback proxy", () => {
    expect(
      resolveEmbedRequestOrigin(
        event(
          {
            "x-forwarded-host": "public.example.test, internal.example.test",
            "x-forwarded-proto": "https, http",
          },
          "127.0.0.1",
          "http://127.0.0.1:3000/card",
        ),
      ),
    ).toBe("https://public.example.test");
  });

  it("preserves a public Fetch URL with the platform's non-loopback client IP", () => {
    const request = Object.assign(
      new Request("https://public.example.test/card", {
        headers: {
          "x-forwarded-host": "public.example.test",
          "x-forwarded-proto": "https",
        },
      }),
      { ip: "203.0.113.42" },
    );
    const input = new H3Event(request);
    expect(getRequestIP(input)).toBe("203.0.113.42");
    expect(resolveEmbedRequestOrigin(input)).toBe(
      "https://public.example.test",
    );
  });

  it("keeps the peer-validated origin when forwarding is not allowlisted", () => {
    vi.stubEnv("APP_URL", "https://internal.example.test");
    expect(
      resolveEmbedRequestOrigin(
        event({
          "x-forwarded-host": "unlisted.example.test",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://internal.example.test");
    expect(resolveEmbedRequestOrigin(event())).toBe(
      "https://internal.example.test",
    );
  });

  it.each<Record<string, string>>([
    { "x-forwarded-host": "" },
    { "x-forwarded-host": "public.example.test/path" },
    { "x-forwarded-host": "person@public.example.test" },
    { "x-forwarded-proto": "ftp" },
    { "x-forwarded-proto": "" },
  ])("refuses malformed forwarding from a loopback proxy: %j", (headers) => {
    vi.stubEnv("APP_URL", "https://public.example.test");
    expect(() =>
      resolveEmbedRequestOrigin(event(headers, "127.0.0.1")),
    ).toThrow(/Invalid (embed|forwarded) request origin/);
  });

  it("refuses a non-HTTP request origin", () => {
    expect(() =>
      resolveEmbedRequestOrigin(
        event({}, "203.0.113.42", "ftp://internal.example.test/card"),
      ),
    ).toThrow("Invalid embed request origin");
  });

  it("resolves embed authority lazily without replacing the ordinary request origin", () => {
    const resolve = vi.fn(() => "https://public.example.test");
    runWithRequestContext(
      {
        requestOrigin: "https://ordinary.example.test",
        resolveEmbedRequestOrigin: resolve,
      },
      () => {
        expect(getRequestContext()?.requestOrigin).toBe(
          "https://ordinary.example.test",
        );
        expect(resolve).not.toHaveBeenCalled();
        expect(getEmbedSessionOrigin()).toBe("https://public.example.test");
        expect(resolve).toHaveBeenCalledTimes(1);
      },
    );
    expect(getEmbedSessionOrigin()).toBeUndefined();
    expect(
      runWithRequestContext(
        { requestOrigin: "https://ordinary.example.test" },
        getEmbedSessionOrigin,
      ),
    ).toBe("https://ordinary.example.test");
  });

  it("does not hide a failed embed-origin resolution behind the ordinary origin", () => {
    const failure = new Error("invalid forwarded authority");
    expect(() =>
      runWithRequestContext(
        {
          requestOrigin: "https://ordinary.example.test",
          resolveEmbedRequestOrigin: () => {
            throw failure;
          },
        },
        getEmbedSessionOrigin,
      ),
    ).toThrow(failure);
  });
});
