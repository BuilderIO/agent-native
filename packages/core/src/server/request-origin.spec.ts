import { describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  getRequestHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
  getRequestIP: (event: any) => event.ip,
  getRequestURL: (event: any) => new URL(event.url ?? "http://localhost/"),
}));

import {
  getForwardedRequestHostname,
  getForwardedRequestHostnameFromHeaders,
  getForwardedRequestOrigin,
  getForwardedRequestURL,
  isSameOriginRequest,
} from "./request-origin.js";

function fakeEvent(
  headers: Record<string, string> = {},
  options: { url?: string; ip?: string } = {},
) {
  return { headers, ...options } as any;
}

describe("getForwardedRequestOrigin", () => {
  it.each([
    {
      name: "forwarded gateway host behind an internal dev proxy",
      headers: {
        host: "127.0.0.1:8092",
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
      },
      ip: "127.0.0.1",
      url: "http://127.0.0.1:8092/",
      expected: "http://127.0.0.1:8080",
    },
    {
      name: "direct host when no proxy forwarded headers are present",
      headers: { host: "dispatch.agent-native.com" },
      url: "http://dispatch.agent-native.com/",
      expected: "http://dispatch.agent-native.com",
    },
    {
      name: "first forwarded host when a proxy appends its internal host",
      headers: {
        host: "internal.gateway:3000",
        "x-forwarded-host":
          "beta.design.agent-native.com, internal.gateway:3000",
        "x-forwarded-proto": "https",
      },
      ip: "::ffff:127.0.0.1",
      url: "http://internal.gateway:3000/",
      expected: "https://beta.design.agent-native.com",
    },
    {
      name: "first forwarded protocol when a proxy appends its internal protocol",
      headers: {
        host: "internal.gateway:3000",
        "x-forwarded-host": "beta.design.agent-native.com",
        "x-forwarded-proto": "https, http",
      },
      ip: "127.0.0.1",
      url: "http://internal.gateway:3000/",
      expected: "https://beta.design.agent-native.com",
    },
  ])("handles $name", ({ headers, expected, url, ip }) => {
    expect(getForwardedRequestOrigin(fakeEvent(headers, { url, ip }))).toBe(
      expected,
    );
  });

  it("ignores forwarded headers from a non-loopback peer", () => {
    expect(
      getForwardedRequestOrigin(
        fakeEvent(
          {
            host: "app.example.test",
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "https",
          },
          { ip: "203.0.113.20", url: "http://app.example.test/" },
        ),
      ),
    ).toBe("http://app.example.test");
  });

  it("uses HTTPS for a production request without trusting forwarded headers", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(
        getForwardedRequestOrigin(
          fakeEvent(
            {
              host: "app.example.test",
              "x-forwarded-host": "attacker.example",
              "x-forwarded-proto": "http",
            },
            { ip: "203.0.113.20", url: "http://app.example.test/" },
          ),
        ),
      ).toBe("https://app.example.test");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("normalizes forwarded hostnames, including terminal dots", () => {
    expect(
      getForwardedRequestHostname(
        fakeEvent(
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": "BETA.CALENDAR.AGENT-NATIVE.COM.",
            "x-forwarded-proto": "https, http",
          },
          { ip: "127.0.0.1", url: "http://internal.gateway:3000/" },
        ),
      ),
    ).toBe("beta.calendar.agent-native.com");
  });

  it("rejects a malformed first forwarded protocol value", () => {
    expect(() =>
      getForwardedRequestHostname(
        fakeEvent(
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": "beta.calendar.agent-native.com",
            "x-forwarded-proto": ", https",
          },
          { ip: "127.0.0.1", url: "http://internal.gateway:3000/" },
        ),
      ),
    ).toThrow("Invalid forwarded request protocol");
  });

  it("rejects a forwarded hostname containing a path", () => {
    expect(() =>
      getForwardedRequestOrigin(
        fakeEvent(
          {
            host: "internal.gateway:3000",
            "x-forwarded-host": "beta.calendar.agent-native.com/path",
            "x-forwarded-proto": "https",
          },
          { ip: "127.0.0.1", url: "http://internal.gateway:3000/" },
        ),
      ),
    ).toThrow("Invalid forwarded request hostname");
  });

  it("resolves the same normalized hostname from Node and Fetch headers", () => {
    expect(
      getForwardedRequestHostnameFromHeaders(
        {
          host: "internal.gateway:3000",
          "x-forwarded-host":
            "BETA.CALENDAR.AGENT-NATIVE.COM., internal.gateway:3000",
        },
        "127.0.0.1",
      ),
    ).toBe("beta.calendar.agent-native.com");
    expect(
      getForwardedRequestHostnameFromHeaders(
        new Headers({ "x-forwarded-host": "beta.calendar.agent-native.com" }),
        "::1",
      ),
    ).toBe("beta.calendar.agent-native.com");
  });

  it("ignores forwarded host headers from non-loopback peers", () => {
    expect(
      getForwardedRequestHostnameFromHeaders(
        {
          host: "app.example.test",
          "x-forwarded-host": "attacker.example.test",
        },
        "203.0.113.20",
      ),
    ).toBe("app.example.test");
  });

  it("rejects malformed Node forwarded hostnames", () => {
    expect(() =>
      getForwardedRequestHostnameFromHeaders(
        {
          host: "app.example.com",
          "x-forwarded-host": "app.example.com/path",
        },
        "127.0.0.1",
      ),
    ).toThrow("Invalid forwarded request hostname");
  });
});

describe("getForwardedRequestURL", () => {
  it("uses the forwarded public origin and keeps the incoming path and query", () => {
    const event = fakeEvent(
      {
        host: "internal.gateway:3000",
        "x-forwarded-host": "dispatch.example.test",
        "x-forwarded-proto": "https, http",
      },
      {
        ip: "127.0.0.1",
        url: "http://internal.gateway:3000/_agent-native/org/apps?include=directory",
      },
    );

    expect(getForwardedRequestURL(event).href).toBe(
      "https://dispatch.example.test/_agent-native/org/apps?include=directory",
    );
  });

  it("keeps a slash-prefixed request path from replacing the request origin", () => {
    const event = fakeEvent(
      {
        "x-forwarded-host": "dispatch.example.test",
        "x-forwarded-proto": "https",
      },
      {
        ip: "127.0.0.1",
        url: "http://internal.gateway:3000//attacker.test/path",
      },
    );

    expect(getForwardedRequestURL(event).href).toBe(
      "https://dispatch.example.test//attacker.test/path",
    );
  });
});

describe("isSameOriginRequest", () => {
  it.each([
    {
      name: "matching Origin and Host",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      expected: true,
    },
    {
      name: "matching Origin and forwarded Host behind a dev proxy",
      headers: {
        host: "127.0.0.1:8088",
        origin: "http://127.0.0.1:8080",
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
        "sec-fetch-site": "same-origin",
      },
      expected: true,
    },
    {
      name: "cross-site fetch metadata despite a matching forwarded Host",
      headers: {
        host: "internal.example:3000",
        origin: "https://app.example.com",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "cross-site",
      },
      expected: false,
    },
    {
      name: "mismatched web origin",
      headers: { host: "app.example.com", origin: "https://evil.example.com" },
      expected: false,
    },
    {
      name: "same host with a mismatched scheme",
      headers: { host: "app.example.com", origin: "http://app.example.com" },
      expected: false,
    },
    {
      name: "malformed Origin",
      headers: { host: "app.example.com", origin: "://invalid" },
      expected: false,
    },
    {
      name: "same-origin fetch metadata",
      headers: { "sec-fetch-site": "same-origin" },
      expected: true,
    },
    {
      name: "non-browser navigation fetch metadata",
      headers: { "sec-fetch-site": "none" },
      expected: true,
    },
    {
      name: "cross-site fetch metadata",
      headers: { "sec-fetch-site": "cross-site" },
      expected: false,
    },
    {
      name: "non-browser client without browser headers",
      headers: {},
      expected: true,
    },
    {
      name: "Tauri production origin against loopback app host",
      headers: { host: "localhost:3000", origin: "tauri://localhost" },
      expected: true,
    },
    {
      name: "Tauri HTTP origin against loopback app host",
      headers: { host: "127.0.0.1:3000", origin: "http://tauri.localhost" },
      expected: true,
    },
    {
      name: "Tauri HTTPS origin against loopback app host",
      headers: { host: "localhost:3000", origin: "https://tauri.localhost" },
      expected: true,
    },
    {
      name: "Tauri dev origin against loopback app host",
      headers: { host: "127.0.0.1:3000", origin: "http://localhost:1420" },
      expected: true,
    },
    {
      name: "Tauri loopback-IP dev origin against loopback app host",
      headers: { host: "localhost:3000", origin: "http://127.0.0.1:1420" },
      expected: true,
    },
    {
      name: "Tauri production origin against remote app host",
      headers: { host: "app.example.com", origin: "tauri://localhost" },
      expected: true,
    },
    {
      name: "Tauri web origin against remote app host",
      headers: { host: "app.example.com", origin: "https://tauri.localhost" },
      expected: false,
    },
    {
      name: "Tauri dev origin against remote app host",
      headers: { host: "app.example.com", origin: "http://localhost:1420" },
      expected: false,
    },
  ])("handles $name", ({ headers, expected }) => {
    expect(isSameOriginRequest(fakeEvent(headers))).toBe(expected);
  });
});
