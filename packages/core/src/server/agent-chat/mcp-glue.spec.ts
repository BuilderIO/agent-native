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

import {
  refreshGlobalMcpManager,
  setGlobalMcpManager,
  waitForGlobalMcpManager,
} from "./mcp-glue.js";

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

  it("waits for lazy initialization before refreshing", async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const manager = { reconfigure: vi.fn().mockResolvedValue(undefined) };
    const config = { source: "settings", servers: {} };
    setGlobalMcpManager(manager as never, () => ready);
    mockedMcp.buildMergedConfig.mockResolvedValue(config);

    const refresh = refreshGlobalMcpManager();
    await Promise.resolve();
    expect(mockedMcp.buildMergedConfig).not.toHaveBeenCalled();

    releaseReady();
    await expect(refresh).resolves.toBe(true);
    expect(manager.reconfigure).toHaveBeenCalledWith(config);
  });

  it("serializes concurrent refresh snapshots", async () => {
    let releaseFirst!: () => void;
    const firstConfig = new Promise((resolve) => {
      releaseFirst = () => resolve({ source: "first", servers: {} });
    });
    const secondConfig = { source: "second", servers: {} };
    const manager = { reconfigure: vi.fn().mockResolvedValue(undefined) };
    setGlobalMcpManager(manager as never);
    mockedMcp.buildMergedConfig
      .mockReturnValueOnce(firstConfig)
      .mockResolvedValueOnce(secondConfig);

    const first = refreshGlobalMcpManager();
    await Promise.resolve();
    const second = refreshGlobalMcpManager();
    await Promise.resolve();
    expect(mockedMcp.buildMergedConfig).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(manager.reconfigure.mock.calls).toEqual([
      [{ source: "first", servers: {} }],
      [secondConfig],
    ]);
  });

  it("returns the current manager after readiness completes", async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const initialManager = {};
    const currentManager = {};
    setGlobalMcpManager(initialManager as never, () => ready);

    const waiting = waitForGlobalMcpManager();
    setGlobalMcpManager(currentManager as never);
    releaseReady();

    await expect(waiting).resolves.toBe(currentManager);
  });
});
