import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAuditAgentWeb } from "./audit-agent-web.js";

describe("runAuditAgentWeb", () => {
  const originalExitCode = process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("passes a site with core agent web surfaces", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const accept = String(
        (init?.headers as Record<string, string> | undefined)?.accept ?? "",
      );
      const body = responseBody(parsed.pathname, accept);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": parsed.pathname.endsWith(".md")
            ? "text/markdown"
            : "text/plain",
          ...(parsed.pathname.endsWith(".md")
            ? { "x-markdown-tokens": "5" }
            : {}),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runAuditAgentWeb(["--url", "https://example.com"]);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("PASS SSR HTML");
    expect(output).toContain("PASS llms.txt");
    expect(output).toContain("PASS Markdown mirror");
    expect(output).toContain("PASS Accept: text/markdown");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints usage and exits non-zero without a URL", async () => {
    await runAuditAgentWeb([]);

    expect(errorSpy).toHaveBeenCalledWith(
      "Usage: agent-native audit-agent-web --url <url>",
    );
    expect(process.exitCode).toBe(1);
  });
});

function responseBody(pathname: string, accept: string): string {
  if (pathname === "/" && accept.includes("text/markdown")) {
    return "# Home\n\nAgent-readable home.\n";
  }
  if (pathname === "/") {
    return `<html><head><link rel="canonical" href="https://example.com/" /><script type="application/ld+json">{}</script></head><body><h1>Agent Web</h1><p>${"Visible content. ".repeat(
      30,
    )}</p></body></html>`;
  }
  if (pathname === "/robots.txt") {
    return `User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n`;
  }
  if (pathname === "/sitemap.xml") {
    return `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>https://example.com/docs</loc></url></urlset>`;
  }
  if (pathname === "/llms.txt") {
    return `# Example\n\n## Markdown\n- [Getting Started](https://example.com/docs/getting-started.md)\n`;
  }
  if (pathname === "/llms-full.txt") {
    return `${responseBody("/llms.txt", "")}\n# Getting Started\n\nFull docs content.\n`;
  }
  if (pathname === "/docs/getting-started.md") {
    return "# Getting Started\n\nHello agents.\n";
  }
  if (pathname === "/docs" && accept.includes("text/markdown")) {
    return "# Getting Started\n\nHello agents.\n";
  }
  return "OK";
}
