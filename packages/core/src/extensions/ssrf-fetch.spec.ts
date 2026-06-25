import { afterEach, describe, expect, it, vi } from "vitest";

import { ssrfSafeFetch } from "./url-safety.js";

// A public IP literal: isBlockedExtensionUrlWithDns short-circuits for IP
// literals (no DNS lookup), so these tests never touch the network — the only
// fetch calls are the stubbed ones below.
const PUBLIC = "http://93.184.216.34/";
const METADATA = "http://169.254.169.254/latest/meta-data/";
const LOOPBACK = "http://127.0.0.1:9/";

describe("ssrfSafeFetch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("blocks an internal/private initial URL before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(ssrfSafeFetch(LOOPBACK)).rejects.toThrow(/SSRF blocked/i);
    await expect(ssrfSafeFetch(METADATA)).rejects.toThrow(/SSRF blocked/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a redirect that points at a private address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: METADATA },
      }),
    );
    await expect(ssrfSafeFetch(PUBLIC)).rejects.toThrow(/SSRF blocked/i);
  });

  it("returns the response for an allowed external URL", async () => {
    const ok = new Response("hello", { status: 200 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok);
    const res = await ssrfSafeFetch(PUBLIC);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("follows an external→external redirect and re-validates each hop", async () => {
    const next = "http://93.184.216.35/final";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: next } }),
      )
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    const res = await ssrfSafeFetch(PUBLIC);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stops after the redirect limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://93.184.216.34/loop" },
      }),
    );
    await expect(
      ssrfSafeFetch(PUBLIC, {}, { maxRedirects: 2 }),
    ).rejects.toThrow(/too many redirects/i);
  });
});
