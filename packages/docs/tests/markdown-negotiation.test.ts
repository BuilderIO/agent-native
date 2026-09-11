import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import markdownNegotiation, {
  acceptsMarkdown,
  config,
} from "../netlify/edge-functions/markdown-negotiation";

describe("markdown negotiation edge function", () => {
  it("recognizes a positive Markdown media range and respects q=0", () => {
    expect(acceptsMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(acceptsMarkdown("text/markdown;q=0, text/html;q=0.9")).toBe(false);
  });

  it("rewrites extensionless pages to the SSR markdown path", () => {
    const rewrite = markdownNegotiation(
      new Request(
        "https://www.agent-native.com/docs/agent-web-surfaces?tab=api",
        {
          headers: { Accept: "text/markdown" },
        },
      ),
    );
    expect(rewrite?.pathname).toBe(
      "/__agent-native-markdown/docs/agent-web-surfaces",
    );
    expect(rewrite?.search).toBe("?tab=api");
  });

  it("leaves static Markdown assets and ordinary browser requests alone", () => {
    expect(
      markdownNegotiation(
        new Request("https://www.agent-native.com/docs/agent-web-surfaces.md", {
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBeUndefined();
    expect(
      markdownNegotiation(
        new Request("https://www.agent-native.com/assets/font.woff2", {
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBeUndefined();
    expect(
      markdownNegotiation(
        new Request("https://www.agent-native.com/docs/page.data", {
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBeUndefined();
    expect(
      markdownNegotiation(
        new Request(
          "https://www.agent-native.com/examples/self-hosted-chat/Dockerfile",
          { headers: { Accept: "text/markdown" } },
        ),
      ),
    ).toBeUndefined();
    expect(
      markdownNegotiation(
        new Request("https://www.agent-native.com/docs/agent-web-surfaces", {
          headers: { Accept: "text/html" },
        }),
      ),
    ).toBeUndefined();
  });

  it("does not rewrite the internal root path a second time", () => {
    expect(
      markdownNegotiation(
        new Request("https://www.agent-native.com/__agent-native-markdown", {
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBeUndefined();
  });

  it("declares the package edge directory for root-based prebuilt builds", () => {
    const config = readFileSync(
      new URL("../netlify.toml", import.meta.url),
      "utf8",
    );

    expect(config).toContain(
      'edge_functions = "packages/docs/netlify/edge-functions"',
    );
    for (const redirectPath of [
      "/examples/self-hosted-chat/Dockerfile",
      "/templates",
      "/templates/*",
      "/:locale/templates/*",
      "/docs/getting-started",
      "/:locale/docs/getting-started",
      "/docs/resources",
      "/docs/workspace",
      "/:locale/docs/workspace",
      "/docs/:locale/workspace",
    ]) {
      expect(config).toContain(`"${redirectPath}"`);
    }
  });
});

describe("edge function exclusions", () => {
  // Every path `netlify.toml` redirects must also be excluded here, or a
  // Markdown request for it gets rewritten to the SSR function and answers 200
  // with a document instead of the redirect the URL is supposed to return.
  // Drift between the two lists is invisible until a crawler hits it.
  it("excludes every path netlify.toml redirects", () => {
    const toml = readFileSync(
      new URL("../netlify.toml", import.meta.url),
      "utf8",
    );
    const redirectSources = [...toml.matchAll(/^from\s*=\s*"([^"]+)"/gm)].map(
      (match) => match[1],
    );

    expect(redirectSources.length).toBeGreaterThan(0);

    const excluded = new Set(config.excludedPath);
    expect(redirectSources.filter((source) => !excluded.has(source))).toEqual(
      [],
    );
  });
});
