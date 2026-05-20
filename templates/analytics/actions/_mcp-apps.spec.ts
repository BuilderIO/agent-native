import { describe, expect, it } from "vitest";
import { analyticsAnalysisMcpAppHtml } from "./_mcp-apps.js";

describe("analytics MCP app markdown rendering", () => {
  it("formats analysis markdown inside the MCP app instead of showing raw markdown", () => {
    const html = analyticsAnalysisMcpAppHtml({});

    expect(html).toContain("function markdownToHtml(markdown)");
    expect(html).toContain("markdownToHtml(markdown)");
    expect(html).toContain("white-space: normal");
    expect(html).toContain(".markdown h1");
    expect(html).not.toContain("esc(toolResult.resultMarkdown");
  });
});
