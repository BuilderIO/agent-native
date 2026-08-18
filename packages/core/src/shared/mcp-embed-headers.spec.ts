import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAgentNativeFirstPartyAppOrigin,
  isChatGptMcpSandboxOrigin,
  isLocalMcpEmbedOrigin,
  isMcpEmbedCorsOrigin,
  isMcpEmbedTransplantOrigin,
  MCP_EMBED_CORS_ALLOW_HEADERS,
  mcpEmbedStaticAssetRouteRules,
  shouldAllowMcpEmbedCredentials,
} from "./mcp-embed-headers.js";

describe("MCP embed headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets nosniff on CDN-served static assets", () => {
    // The h3 security-headers middleware never runs for these paths.
    for (const rule of Object.values(mcpEmbedStaticAssetRouteRules())) {
      expect(rule.headers["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("allows frontend action-client headers from embedded apps", () => {
    expect(MCP_EMBED_CORS_ALLOW_HEADERS).toContain("X-Agent-Native-Frontend");
    expect(MCP_EMBED_CORS_ALLOW_HEADERS).toContain(
      "X-Agent-Native-Client-Compatibility",
    );
    expect(MCP_EMBED_CORS_ALLOW_HEADERS).toContain("X-Agent-Native-Build-Id");
  });

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

  it("allows known MCP product host origins without credentialed CORS", () => {
    for (const origin of [
      "https://claude.ai",
      "https://chatgpt.com",
      "https://chat.openai.com",
    ]) {
      expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
      expect(shouldAllowMcpEmbedCredentials(origin)).toBe(false);
    }
  });

  it("allows Builder preview origins for embed CORS", () => {
    for (const origin of [
      "https://builder.io",
      "https://workspace.builder.io",
      "https://builder.my",
      "https://workspace.builder.my",
      "https://preview.builderio.xyz",
      "https://preview.builderio.dev",
      "https://preview.builder.codes",
    ]) {
      expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
    }
  });

  it("rejects spoofed or insecure Builder preview origins", () => {
    for (const origin of [
      "https://builderio.xyz.evil.example",
      "https://evilbuilderio.xyz",
      "https://preview.builder.codes.evil.example",
      "http://preview.builderio.dev",
      "https://user:pass@preview.builderio.xyz",
    ]) {
      expect(isMcpEmbedCorsOrigin(origin)).toBe(false);
    }
  });

  it("only allows explicitly configured or exact native origins to read credentialed responses", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://preview.example.com");
    expect(shouldAllowMcpEmbedCredentials("https://preview.example.com")).toBe(
      true,
    );
    expect(shouldAllowMcpEmbedCredentials("https://builder.io")).toBe(false);
    expect(shouldAllowMcpEmbedCredentials("https://workspace.builder.io")).toBe(
      false,
    );
    expect(shouldAllowMcpEmbedCredentials("http://localhost:9310")).toBe(false);
    expect(shouldAllowMcpEmbedCredentials("https://evil.example")).toBe(false);
    expect(shouldAllowMcpEmbedCredentials("tauri://localhost")).toBe(true);
    expect(shouldAllowMcpEmbedCredentials("https://tauri.localhost")).toBe(
      true,
    );
  });

  it("does not allow builder or local fallback origins to read credentialed responses", () => {
    expect(shouldAllowMcpEmbedCredentials("https://builder.io")).toBe(false);
    expect(shouldAllowMcpEmbedCredentials("https://workspace.builder.io")).toBe(
      false,
    );
    expect(shouldAllowMcpEmbedCredentials("http://localhost:9310")).toBe(false);
  });

  it("only allows trusted MCP or first-party origins to read transplant locations", () => {
    expect(
      isMcpEmbedTransplantOrigin(
        "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
      ),
    ).toBe(true);
    expect(isMcpEmbedTransplantOrigin("https://design.agent-native.com")).toBe(
      true,
    );
    expect(isMcpEmbedTransplantOrigin("https://workspace.builder.io")).toBe(
      false,
    );
    expect(isMcpEmbedTransplantOrigin("http://localhost:9310")).toBe(false);
    expect(isMcpEmbedTransplantOrigin("null")).toBe(false);
  });

  it("allows first-party hosted apps to embed sibling MCP apps without credentialed CORS", () => {
    for (const origin of [
      "https://design.agent-native.com",
      "https://assets.agent-native.com",
      "https://team.design.agent-native.com",
    ]) {
      expect(isAgentNativeFirstPartyAppOrigin(origin)).toBe(true);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(true);
      expect(shouldAllowMcpEmbedCredentials(origin)).toBe(false);
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

  it("rejects agent-native suffix spoofs and non-hosted app origins", () => {
    for (const origin of [
      "https://agent-native.com",
      "https://design.agent-native.com.evil.example",
      "https://evil-agent-native.com",
      "http://design.agent-native.com",
      "https://design.agent-native.com:4443",
    ]) {
      expect(isAgentNativeFirstPartyAppOrigin(origin)).toBe(false);
      expect(isMcpEmbedCorsOrigin(origin)).toBe(false);
    }
  });
});
