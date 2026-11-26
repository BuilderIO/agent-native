import { beforeEach, describe, expect, it, vi } from "vitest";

import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  fetchDesignReferenceCopy,
  fetchDesignReferenceResource,
  rewriteReferenceCss,
} from "./design-reference-copy.js";

vi.mock("../extensions/url-safety.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../extensions/url-safety.js")>();
  return {
    ...original,
    ssrfSafeFetch: vi.fn(original.ssrfSafeFetch),
    // Unit tests stay offline; a named host stands in for one that resolves privately.
  };
});

beforeEach(() => {
  vi.mocked(ssrfSafeFetch).mockClear();
});

describe("Design public reference copy", () => {
  it("rewrites relative stylesheet imports, fonts, and backgrounds through the checked bridge", () => {
    const css = rewriteReferenceCss(
      '@import "./theme.css"; @font-face{src:url(../fonts/site.woff2)} .hero{background:url(../images/hero.png)}',
      "https://example.com/css/main.css",
      "http://127.0.0.1:7331",
      "token",
    );
    for (const resource of [
      "https://example.com/css/theme.css",
      "https://example.com/fonts/site.woff2",
      "https://example.com/images/hero.png",
    ]) {
      const proxy = new URL(
        `/reference-resource?url=${encodeURIComponent(resource)}&previewToken=token`,
        "http://127.0.0.1:7331",
      ).href;
      expect(css).toContain(proxy);
    }
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:password@example.com/",
  ])("rejects nonpublic or credentialed URL %s", async (url) => {
    await expect(
      fetchDesignReferenceCopy(url, "http://127.0.0.1:7331", "token"),
    ).rejects.toThrow();
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
      "http://127.0.0.1:7331",
      "token",
    );
    expect(result.framingBlocked).toBe(true);
    expect(result.html).toContain("Public reference");
    expect(result.html).toContain(
      'href="http://127.0.0.1:7331/reference-resource?url=https%3A%2F%2Fexample.com%2Fstyle.css&amp;previewToken=token"',
    );
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

  it("sanitizes markup nested inside template elements", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(
        '<html><head></head><body><template shadowrootmode="open"><p onclick="alert(1)">Kept</p><script>alert(1)</script><img src="http://localhost/x.png"><template><iframe src="https://example.com/"></iframe></template></template></body></html>',
        { headers: { "content-type": "text/html" } },
      ),
    );
    const result = await fetchDesignReferenceCopy(
      "https://example.com/reference",
      "http://127.0.0.1:7331",
      "token",
    );
    expect(result.html).toContain("<p>Kept</p>");
    expect(result.html).not.toMatch(
      /onclick=|<script|<iframe|src="https?:\/\/localhost/,
    );
  });

  it("bounds the entire operation even when DNS or upstream never returns", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(ssrfSafeFetch).mockImplementationOnce(
        () => new Promise<Response>(() => {}),
      );
      const result = expect(
        fetchDesignReferenceCopy(
          "https://example.com/",
          "http://127.0.0.1:7331",
          "token",
        ),
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
      fetchDesignReferenceCopy(
        "https://example.com/",
        "http://127.0.0.1:7331",
        "token",
      ),
    ).rejects.toThrow("2 MiB");
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response("login", {
        status: 401,
        headers: { "www-authenticate": "Basic", "content-type": "text/html" },
      }),
    );
    await expect(
      fetchDesignReferenceCopy(
        "https://example.com/",
        "http://127.0.0.1:7331",
        "token",
      ),
    ).rejects.toThrow("public reference");
  });

  it("proxies retained resources and locks CSP to the local proxy origin", async () => {
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
          <style>@import "./theme.css"; @import "http://192.168.1.1/x.css"; body { background: url(https://localhost/bg.png) } .ok { background: url('/ok.png') } .svg { fill: url(#grad) }</style>
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
    const { html } = await fetchDesignReferenceCopy(
      "https://example.com/page",
      "http://127.0.0.1:7331",
      "token",
    );
    for (const target of ["preconnect", "prefetch"])
      expect(html).not.toContain(target);
    expect(html).toContain(
      'href="http://127.0.0.1:7331/reference-resource?url=https%3A%2F%2Fcdn.example.com%2Fsite.css&amp;previewToken=token"',
    );
    expect(html).toContain(
      'src="http://127.0.0.1:7331/reference-resource?url=https%3A%2F%2Frebind.example.com%2Fa.png&amp;previewToken=token"',
    );
    expect(html).toContain(
      "url(http://127.0.0.1:7331/reference-resource?url=https%3A%2F%2Flocalhost%2Fbg.png&previewToken=token)",
    );
    expect(html).toContain(
      '@import "http://127.0.0.1:7331/reference-resource?url=https%3A%2F%2Fexample.com%2Ftheme.css&previewToken=token"',
    );
    expect(html).toContain("fill: url(#grad)");
    expect(html).toContain(
      "url=https%3A%2F%2Fimages.example.org%2Fhero%402x.png&amp;previewToken=token 2x",
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(csp?.split("; ")).toEqual([
      "default-src 'none'",
      "img-src data: http://127.0.0.1:7331",
      "style-src 'unsafe-inline' http://127.0.0.1:7331",
      "font-src data: http://127.0.0.1:7331",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "connect-src 'none'",
    ]);
    expect(csp).not.toContain("example.com");
  });

  it("places CSP before content despite a leading comment and sanitizes noscript refresh", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response(
        '<!--<head>--><html><head><noscript><meta http-equiv="refresh" content="0;url=https://evil.example/"></noscript></head><body>ok</body></html>',
        { headers: { "content-type": "text/html" } },
      ),
    );
    const { html } = await fetchDesignReferenceCopy(
      "https://example.com/",
      "http://127.0.0.1:7331",
      "token",
    );
    expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
      html.indexOf("<body"),
    );
    expect(html).not.toContain("evil.example");
  });

  it("proxies only bounded image, stylesheet, and font resources through SSRF-safe GET", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response("image", { headers: { "content-type": "image/png" } }),
    );
    await expect(
      fetchDesignReferenceResource("file:///private.png"),
    ).rejects.toThrow();
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(
      new Response("image", { headers: { "content-type": "image/png" } }),
    );
    const result = await fetchDesignReferenceResource(
      "https://example.com/a.png",
    );
    expect(result.contentType).toBe("image/png");
    expect(ssrfSafeFetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "GET", credentials: "omit" }),
      { requireDispatcher: true },
    );
  });
});
