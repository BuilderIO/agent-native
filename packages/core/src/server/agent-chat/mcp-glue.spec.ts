import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedMcp = vi.hoisted(() => {
  class TestMcpConfigUnreadableError extends Error {
    constructor() {
      super("Could not read MCP configuration from settings: unavailable");
      this.name = "McpConfigUnreadableError";
    }
  }
  return {
    buildMergedConfig: vi.fn(),
    TestMcpConfigUnreadableError,
  };
});

vi.mock("../../mcp-client/index.js", () => ({
  buildMergedConfig: mockedMcp.buildMergedConfig,
  getHubStatus: vi.fn(),
  McpClientManager: class {},
  McpConfigUnreadableError: mockedMcp.TestMcpConfigUnreadableError,
}));

vi.mock("../framework-request-handler.js", () => ({
  getH3App: (app: { h3: unknown }) => app.h3,
}));

import { refreshGlobalMcpManager, setGlobalMcpManager } from "./mcp-glue.js";

describe("refreshGlobalMcpManager", () => {
  beforeEach(() => {
    mockedMcp.buildMergedConfig.mockReset();
    setGlobalMcpManager(null as never);
  });

  it("returns false when settings cannot be read", async () => {
    const manager = { reconfigure: vi.fn() };
    setGlobalMcpManager(manager as never);
    mockedMcp.buildMergedConfig.mockRejectedValue(
      new mockedMcp.TestMcpConfigUnreadableError(),
    );

    await expect(refreshGlobalMcpManager()).resolves.toBe(false);
    expect(manager.reconfigure).not.toHaveBeenCalled();
  });

  it("reconfigures and reports success for a readable config", async () => {
    const manager = { reconfigure: vi.fn().mockResolvedValue(undefined) };
    const config = { source: "settings", servers: {} };
    setGlobalMcpManager(manager as never);
    mockedMcp.buildMergedConfig.mockResolvedValue(config);

    await expect(refreshGlobalMcpManager()).resolves.toBe(true);
    expect(manager.reconfigure).toHaveBeenCalledWith(config);
  });
});
