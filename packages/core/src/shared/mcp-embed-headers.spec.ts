import { describe, expect, it } from "vitest";
import {
  isChatGptMcpSandboxOrigin,
  isLocalMcpEmbedOrigin,
  isMcpEmbedCorsOrigin,
} from "./mcp-embed-headers.js";

describe("MCP embed headers", () => {
  it("allows ChatGPT web-sandbox origins", () => {
    for (const origin of [
      "https://web-sandbox.oaiusercontent.com",
      "https://shakira-professor-conscious-frederick-trycloudflare-com.web-sandbox.oaiusercontent.com",
    ]) {
      expect(isChatGptMcpSandboxOrigin(origin)).toBe(true);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
    }
  });

  it("allows localhost origins for local MCP app QA", () => {
    for (const origin of [
      "http://localhost:9310",
      "http://127.0.0.1:9310",
      "http://[::1]:9310",
    ]) {
      expect(isLocalMcpEmbedOrigin(origin)).toBe(true);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
    }
  });

  it("rejects non-sandbox oaiusercontent origins", () => {
    for (const origin of [
      "https://files.oaiusercontent.com",
      "https://example.oaiusercontent.com",
      "https://web-sandbox.oaiusercontent.com.evil.example",
      "https://localhost:9310",
      "http://example.com",
    ]) {
      expect(isChatGptMcpSandboxOrigin(origin)).toBe(false);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(false);
    }
  });
});
