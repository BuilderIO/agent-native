import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import markdownNegotiation, {
  acceptsMarkdown,
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
        new Request("https://www.agent-native.com/docs/agent-web-surfaces", {
          headers: { Accept: "text/html" },
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
  });
});
