import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeState = vi.hoisted(() => ({ active: false }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("./mcp-chat-bridge", () => ({
  isMcpChatBridgeActive: () => bridgeState.active,
}));

const { canUseAgentGenerate } = await import("./agent-generate");

function statusResponse(configured: boolean) {
  return {
    ok: true,
    json: async () => ({ configured }),
  };
}

describe("canUseAgentGenerate", () => {
  beforeEach(() => {
    bridgeState.active = false;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("allows MCP host bridge generate even when local engine status is unavailable", async () => {
    bridgeState.active = true;

    await expect(canUseAgentGenerate()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a configured local agent engine outside MCP host bridge mode", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(false))
      .mockResolvedValueOnce(statusResponse(false));

    await expect(canUseAgentGenerate()).resolves.toBe(false);
  });

  it("allows local generate when Builder or an agent engine is configured", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(false))
      .mockResolvedValueOnce(statusResponse(true));

    await expect(canUseAgentGenerate()).resolves.toBe(true);
  });
});
