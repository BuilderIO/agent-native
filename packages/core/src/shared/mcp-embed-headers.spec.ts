import { describe, expect, it } from "vitest";
import {
  isChatGptMcpSandboxOrigin,
  isMcpEmbedCorsOrigin,
} from "./mcp-embed-headers.js";

describe("MCP embed headers", () => {
  it("allows ChatGPT web-sandbox origins", () => {
    const origin =
      "https://shakira-professor-conscious-frederick-trycloudflare-com.web-sandbox.oaiusercontent.com";

    expect(isChatGptMcpSandboxOrigin(origin)).toBe(true);
    expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
  });

  it("rejects non-sandbox oaiusercontent origins", () => {
    for (const origin of [
      "https://files.oaiusercontent.com",
      "https://example.oaiusercontent.com",
      "https://web-sandbox.oaiusercontent.com.evil.example",
    ]) {
      expect(isChatGptMcpSandboxOrigin(origin)).toBe(false);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(false);
    }
  });
});
