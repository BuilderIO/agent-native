import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrl,
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "./url-safety.js";

describe("createSsrfSafeDispatcher", () => {
  it("loads the packaged server dispatcher instead of falling back to bare fetch", async () => {
    await expect(createSsrfSafeDispatcher()).resolves.toMatchObject({
      dispatch: expect.any(Function),
    });
  });

  it("preserves optional dispatcher behavior when Node DNS is unavailable", async () => {
    vi.doMock("node:dns", () => {
      throw new Error("node:dns unavailable");
    });
    vi.resetModules();
    try {
      const mod = await import("./url-safety.js");
      await expect(mod.createSsrfSafeDispatcher()).resolves.toBeNull();
      await expect(
        mod.createSsrfSafeDispatcher([], undefined, { required: true }),
      ).rejects.toThrow(/dispatcher could not be loaded/);
    } finally {
      vi.doUnmock("node:dns");
      vi.resetModules();
    }
  });

  it("retains guarded fetch behavior in edge runtimes without a Node dispatcher", async () => {
    vi.doMock("node:dns", () => {
      throw new Error("node:dns unavailable");
    });
    vi.doMock("node:dns/promises", () => ({
      lookup: vi
        .fn()
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    );
    vi.resetModules();
    try {
      const mod = await import("./url-safety.js");
      await expect(
        mod.ssrfSafeFetch("https://example.com/data"),
      ).resolves.toBeInstanceOf(Response);
      expect(fetch).toHaveBeenCalledWith(
        "https://example.com/data",
        expect.not.objectContaining({ dispatcher: expect.anything() }),
      );
    } finally {
      vi.doUnmock("node:dns");
      vi.doUnmock("node:dns/promises");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("allows a configured loopback hostname at its exact port through the real dispatcher", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP port.");
      }
      const origin = `http://localhost:${address.port}`;
      const response = await ssrfSafeFetch(
        `${origin}/health`,
        {},
        {
          allowedPrivateOrigins: [origin],
        },
      );
      await expect(response.text()).resolves.toBe("ok");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

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

describe("ssrfSafeFetch per-hop policies", () => {
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

  it("can return a validated redirect for a caller with its own redirect policy", async () => {
    const redirectResponse = new Response("moved", {
      status: 302,
      headers: { location: httpOrigin },
    });
    const fetchMock = vi.fn(async () => redirectResponse);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ssrfSafeFetch(httpsOrigin, {}, { followRedirects: false }),
    ).resolves.toBe(redirectResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redirectResponse.bodyUsed).toBe(false);
  });

  it("allows configured loopback aliases without allowing an unconfigured port", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ssrfSafeFetch(
        "http://localhost:4123/health",
        {},
        { allowedPrivateOrigins: ["http://127.0.0.1:4123"] },
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      ssrfSafeFetch(
        "http://localhost:4124/health",
        {},
        {
          allowedPrivateOrigins: ["http://127.0.0.1:4123"],
        },
      ),
    ).rejects.toThrow(/SSRF blocked/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a caller-disallowed redirect before forwarding sensitive request data", async () => {
    const redirectUrl = "https://93.184.216.35/steal";
    const redirectResponse = new Response("moved", {
      status: 302,
      headers: { location: redirectUrl },
    });
    const fetchMock = vi.fn(async () => redirectResponse);
    const assertUrlAllowed = vi.fn((url: string) => {
      if (url !== httpsOrigin) {
        throw new Error(`URL ${url} is not in the credential allowlist`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ssrfSafeFetch(
        httpsOrigin,
        {
          method: "POST",
          headers: { Authorization: "Bearer example-token" },
          body: "sensitive payload",
        },
        { assertUrlAllowed },
      ),
    ).rejects.toThrow(/not in the credential allowlist/);

    expect(assertUrlAllowed).toHaveBeenNthCalledWith(1, httpsOrigin);
    expect(assertUrlAllowed).toHaveBeenNthCalledWith(2, redirectUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(httpsOrigin);
    expect(redirectResponse.bodyUsed).toBe(true);
  });
});
