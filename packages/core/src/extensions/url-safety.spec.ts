import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isBlockedExtensionUrl,
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "./url-safety.js";

describe("isBlockedExtensionUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://100.64.0.1/",
    "http://192.0.2.1/",
    "http://198.18.0.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff00::1]/",
    "http://[::ffff:7f00:1]/",
    "http://metadata.google.internal/",
  ])("blocks non-public target %s", (url) => {
    expect(isBlockedExtensionUrl(url)).toBe(true);
  });

  it("allows ordinary public HTTP origins", () => {
    expect(isBlockedExtensionUrl("https://93.184.216.34/api")).toBe(false);
    expect(isBlockedExtensionUrl("https://example.com/api")).toBe(false);
  });
});

describe("isBlockedExtensionUrlWithDns (DNS rebinding guard)", () => {
  it("blocks a public hostname that resolves to a private IP", async () => {
    // Mock node:dns/promises so this test doesn't hit the network.
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(
      await mod.isBlockedExtensionUrlWithDns("https://attacker.example.com/"),
    ).toBe(true);
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("blocks even when one of multiple resolved IPs is private", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(await mod.isBlockedExtensionUrlWithDns("https://example.com/")).toBe(
      true,
    );
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("allows a hostname that resolves to a public IP", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }));
    vi.resetModules();
    const mod = await import("./url-safety.js");
    expect(await mod.isBlockedExtensionUrlWithDns("https://example.com/")).toBe(
      false,
    );
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });
});

describe("ssrfSafeFetch httpsOnly", () => {
  // Public IP literals skip the DNS lookup, so these tests stay offline.
  const httpsOrigin = "https://93.184.216.34/image.png";
  const httpOrigin = "http://93.184.216.34/image.png";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a non-HTTPS initial URL before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ssrfSafeFetch(httpOrigin, {}, { httpsOnly: true }),
    ).rejects.toThrow(/SSRF blocked: refusing to fetch non-HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an HTTPS→HTTP redirect downgrade before following it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: httpOrigin } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ssrfSafeFetch(httpsOrigin, {}, { httpsOnly: true }),
    ).rejects.toThrow(/SSRF blocked: refusing to fetch non-HTTPS/);
    // Only the initial HTTPS request went out; the HTTP hop was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(httpsOrigin);
  });

  it("still follows HTTP redirects when httpsOnly is not set", async () => {
    const redirectResponse = new Response("moved", {
      status: 302,
      headers: { location: httpOrigin },
    });
    const fetchMock = vi.fn(async (url: string) =>
      url === httpsOrigin
        ? redirectResponse
        : new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await ssrfSafeFetch(httpsOrigin);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The followed hop's body must be drained so its connection is released.
    expect(redirectResponse.bodyUsed).toBe(true);
  });
});
