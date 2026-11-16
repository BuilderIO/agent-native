import { beforeEach, describe, expect, it, vi } from "vitest";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { fetchDesignReferenceCopy } from "./design-reference-copy.js";

vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return {
    ...original,
    ssrfSafeFetch: vi.fn(original.ssrfSafeFetch),
    // Unit tests stay offline; a named host stands in for one that resolves privately.
    isBlockedExtensionUrlWithDns: vi.fn(
      async (url: string) =>
        original.isBlockedExtensionUrl(url) ||
        new URL(url).hostname === "rebind.example.com",
    ),
  };
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
    expect(result.html).toContain("Public reference");
    expect(result.html).toContain('href="https://example.com/style.css"');
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

  it("keeps only public HTTPS subresources and limits the CSP to their origins", async () => {
    const privateTargets = [
      "http://cdn.example.com/plain-http.png",
      "https://localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://10.0.0.8/a.png",
      "https://[::1]/a.png",
      "https://printer.local/a.png",
      "https://admin.corp.internal/a.png",
      "https://169.254.169.254/latest",
      "https://rebind.example.com/a.png",
      "https://intranet/a.png",
    ];
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(
        `<html><head>
          <link rel="stylesheet" href="https://cdn.example.com/site.css">
          <link rel="preconnect" href="https://10.0.0.8/">
          <link rel="prefetch" href="https://cdn.example.com/next">
          <style>@import "http://192.168.1.1/x.css"; body { background: url(https://localhost/bg.png) } .ok { background: url('/ok.png') } .svg { fill: url(#grad) }</style>
        </head><body>
          ${privateTargets.map((src) => `<img src="${src}">`).join("")}
          <img src="https://images.example.org/hero.png" srcset="https://images.example.org/hero@2x.png 2x, http://192.168.0.2/x.png 3x">
          <div style="background-image: url(http://192.168.0.3/x.png)"></div>
          <img src="data:image/png;base64,AAAA">
          <a href="http://192.168.0.4/admin">router</a>
        </body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
    );
    const { html } = await fetchDesignReferenceCopy("https://example.com/page");
    for (const target of [
      ...privateTargets,
      "192.168.",
      "https://localhost/bg.png",
      "preconnect",
      "prefetch",
    ])
      expect(html).not.toContain(target);
    expect(html).toContain('href="https://cdn.example.com/site.css"');
    expect(html).toContain('url("https://example.com/ok.png")');
    expect(html).toContain("url(#grad)");
    expect(html).toContain(
      'srcset="https://images.example.org/hero@2x.png 2x"',
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(csp?.split("; ")).toEqual([
      "default-src 'none'",
      "img-src data: https://cdn.example.com https://example.com https://images.example.org",
      "style-src 'unsafe-inline' https://cdn.example.com https://example.com https://images.example.org",
      "font-src data: https://cdn.example.com https://example.com https://images.example.org",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "connect-src 'none'",
    ]);
    expect(csp).not.toMatch(/\bhttps?:(?!\/\/)/);
  });
});
