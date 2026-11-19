import { describe, expect, it } from "vitest";

import { mcpIntegrationLogo } from "./mcp-integration-logos.js";

describe("MCP integration logos", () => {
  it("provides distinct renderable images for the setup clients", () => {
    const logos = ["claude", "cursor", "vscode", "grok", "openai"].map(
      mcpIntegrationLogo,
    );
    for (const logo of logos) {
      expect(logo).toMatch(/^data:image\/(svg\+xml|png);base64,/);
      const data = Buffer.from(logo.split(",")[1] ?? "", "base64");
      if (logo.startsWith("data:image/png")) {
        expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      } else {
        expect(data.toString()).toContain("<svg");
      }
    }
    expect(new Set(logos).size).toBe(logos.length);
    expect(mcpIntegrationLogo("unknown-client")).toBe("");
  });
});
