import { describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: () => "POST",
  getRequestHeader: () => undefined,
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (nitroApp: any) => nitroApp.h3,
}));

vi.mock("../server/auth.js", () => ({
  isLoopbackRequest: () => false,
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(),
}));

vi.mock("./build-server.js", () => ({
  buildLinkArtifacts: vi.fn(),
  createMCPServerForRequest: vi.fn(),
  getAccessTokens: vi.fn(),
  resolveOrgIdFromDomain: vi.fn(),
  verifyAuth: vi.fn(),
}));

vi.mock("./oauth-route.js", () => ({
  buildMcpOAuthChallenge: vi.fn(),
  getMcpOAuthAudiences: vi.fn(),
  getMcpOAuthIssuer: vi.fn(),
  getMcpOAuthProtectedResourceMetadataUrl: vi.fn(),
  getMcpOAuthResource: vi.fn(),
}));

const { mountMCP } = await import("./server.js");

describe("mountMCP", () => {
  it("mounts the public and legacy protocol paths by default", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any);

    expect(use.mock.calls.map(([path]) => path)).toEqual([
      "/_agent-native/mcp",
      "/mcp",
    ]);
  });

  it("does not add the public alias to a custom route prefix", () => {
    const use = vi.fn();
    mountMCP({ h3: { use } }, { actions: {} } as any, "/custom");

    expect(use.mock.calls.map(([path]) => path)).toEqual(["/custom/mcp"]);
  });
});
