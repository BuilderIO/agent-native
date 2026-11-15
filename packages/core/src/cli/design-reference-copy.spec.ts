import { beforeEach, describe, expect, it, vi } from "vitest";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { fetchDesignReferenceCopy } from "./design-reference-copy.js";

vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return { ...original, ssrfSafeFetch: vi.fn(original.ssrfSafeFetch) };
});

beforeEach(() => {
  vi.mocked(ssrfSafeFetch).mockClear();
});

describe("Design public reference copy", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:password@example.com/",
  ])("rejects nonpublic or credentialed URL %s", async (url) => {
    await expect(fetchDesignReferenceCopy(url)).rejects.toThrow();
  });

  it("returns an inert reference with a base and drops upstream framing/session policy", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(
        '<html><head data-reference="source"><meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><base href="https://attacker.invalid/"><link rel="stylesheet" href="/style.css"></head><body onclick="alert(1)"><h1>Public reference</h1><script>alert(1)</script><form action="/write"><input></form><iframe src="http://localhost/"></iframe></body></html>',
        {
          headers: {
            "content-type": "text/html",
            "x-frame-options": "DENY",
            "content-security-policy": "frame-ancestors 'none'",
            "set-cookie": "session=fake",
          },
        },
      ),
    );
    const result = await fetchDesignReferenceCopy(
      "https://example.com/reference",
    );
    expect(result.framingBlocked).toBe(true);
    expect(result.html).toContain(
      '<base href="https://example.com/reference">',
    );
    expect(result.html).toContain("Public reference");
    expect(result.html).toContain('href="/style.css"');
    expect(result.html).not.toMatch(
      /<script|<form|<iframe|onclick=|attacker\.invalid|frame-ancestors|session=fake/,
    );
    expect(ssrfSafeFetch).toHaveBeenCalledWith(
      "https://example.com/reference",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        headers: { accept: "text/html" },
      }),
      { requireDispatcher: true },
    );
  });

  it("bounds the entire operation even when DNS or upstream never returns", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(ssrfSafeFetch).mockImplementationOnce(
        () => new Promise<Response>(() => {}),
      );
      const result = expect(
        fetchDesignReferenceCopy("https://example.com/"),
      ).rejects.toThrow("10 second timeout");
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects oversized HTML and authentication challenges", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response("x".repeat(2 * 1024 * 1024 + 1), {
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      fetchDesignReferenceCopy("https://example.com/"),
    ).rejects.toThrow("2 MiB");
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response("login", {
        status: 401,
        headers: { "www-authenticate": "Basic", "content-type": "text/html" },
      }),
    );
    await expect(
      fetchDesignReferenceCopy("https://example.com/"),
    ).rejects.toThrow("public reference");
  });
});
