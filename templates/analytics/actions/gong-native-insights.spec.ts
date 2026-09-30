import { beforeEach, describe, expect, it, vi } from "vitest";

const listVisibleMcpToolsMock = vi.hoisted(() => vi.fn());
const callMcpToolMock = vi.hoisted(() => vi.fn());
const readGongNativeInsightsPolicy = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/mcp-client", () => ({
  listVisibleMcpTools: listVisibleMcpToolsMock,
  callMcpTool: callMcpToolMock,
}));

vi.mock("../server/lib/gong-native-policy", () => ({
  readGongNativeInsightsPolicy,
}));

const { default: action } = await import("./gong-native-insights");

const askAccountTool = {
  serverId: "org_gong",
  name: "ask_account",
  description: "Ask Gong about an account",
  inputSchema: {
    type: "object",
    properties: { account: { type: "string" } },
  },
};

describe("gong-native-insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listVisibleMcpToolsMock.mockResolvedValue([askAccountTool]);
    readGongNativeInsightsPolicy.mockResolvedValue({
      enabled: true,
      configured: true,
      scope: "workspace",
      updatedAt: "2026-07-17T12:00:00.000Z",
    });
  });

  it("lists native schemas without consuming a semantic request", async () => {
    await expect(action.run({})).resolves.toMatchObject({
      connected: true,
      creditRequests: 0,
      operations: [
        {
          operation: "ask_account",
          serverId: "org_gong",
          inputSchema: askAccountTool.inputSchema,
        },
      ],
    });
    expect(callMcpToolMock).not.toHaveBeenCalled();
    expect(readGongNativeInsightsPolicy).not.toHaveBeenCalled();
  });

  it("rejects execution arguments instead of silently listing", async () => {
    await expect(
      action.run({
        operation: "ask_account",
        allowCreditRequest: true,
        arguments: { account: "Acme" },
      } as never),
    ).rejects.toThrow(/run-gong-native-insight/);
    expect(listVisibleMcpToolsMock).not.toHaveBeenCalled();
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("is not grounding evidence because it reads no customer data", () => {
    expect(action.grounding).not.toBe(true);
  });

  it("is a free read that points paid requests at run-gong-native-insight", async () => {
    expect(action.readOnly).toBe(true);
    expect(action.needsApproval).toBeUndefined();
    expect(action.tool.parameters?.properties ?? {}).toEqual({});
    await expect(action.run({})).resolves.toMatchObject({
      executionAction: "run-gong-native-insight",
    });
  });
});
