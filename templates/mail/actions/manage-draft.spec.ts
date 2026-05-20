import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("manage-draft MCP App", () => {
  it("reuses the real Mail app embed instead of a bespoke compose form", () => {
    const source = readFileSync(new URL("./manage-draft.ts", import.meta.url), {
      encoding: "utf8",
    });

    expect(source).toContain("embedApp({");
    expect(source).toContain('openLabel: "Open in Mail"');
    expect(source).toContain('iframeTitle: "Agent-Native Mail"');
    expect(source).toContain('"https:"');
    expect(source).toContain('"http://localhost:*"');
    expect(source).toContain('"http://127.0.0.1:*"');
    expect(source).not.toContain("mailDraftMcpAppHtml");
    expect(source).not.toContain("_mcp-apps");
    expect(source).not.toContain("data-save");
    expect(source).not.toContain("Update draft");
    expect(existsSync(new URL("./_mcp-apps.ts", import.meta.url))).toBe(false);
  });
});
