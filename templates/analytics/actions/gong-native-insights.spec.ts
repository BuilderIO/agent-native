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
    await expect(action.run({ arguments: {} })).resolves.toMatchObject({
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
  });

  it("passes one consolidated request to the connected Gong operation", async () => {
    callMcpToolMock.mockResolvedValue({ answer: "Renewal risk is pricing." });

    await expect(
      action.run({
        operation: "ask_account",
        allowCreditRequest: true,
        arguments: { account: "Acme", question: "Summarize renewal risk" },
      }),
    ).resolves.toMatchObject({
      source: "gong-native-mcp",
      operation: "ask_account",
      creditRequests: 1,
      result: { answer: "Renewal risk is pricing." },
    });
    expect(callMcpToolMock).toHaveBeenCalledOnce();
    expect(callMcpToolMock).toHaveBeenCalledWith("org_gong", "ask_account", {
      account: "Acme",
      question: "Summarize renewal risk",
    });
  });

  it("does not spend a request without explicit credit authorization", async () => {
    await expect(
      action.run({
        operation: "ask_account",
        allowCreditRequest: false,
        arguments: { account: "Acme" },
      }),
    ).resolves.toMatchObject({
      blocked: true,
      creditRequests: 0,
      evidenceFallbackAction: "gong-calls",
    });
    expect(callMcpToolMock).not.toHaveBeenCalled();
    expect(readGongNativeInsightsPolicy).not.toHaveBeenCalled();
  });

  it("does not spend a request while the workspace policy is disabled", async () => {
    readGongNativeInsightsPolicy.mockResolvedValue({
      enabled: false,
      configured: true,
      scope: "workspace",
      updatedAt: "2026-07-17T12:00:00.000Z",
    });

    await expect(
      action.run({
        operation: "ask_account",
        allowCreditRequest: true,
        arguments: { account: "Acme" },
      }),
    ).resolves.toMatchObject({
      blocked: true,
      blockedBy: "workspace-policy",
      creditRequests: 0,
      evidenceFallbackAction: "gong-calls",
    });
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("returns the evidence fallback when Gong native MCP is unavailable", async () => {
    listVisibleMcpToolsMock.mockResolvedValue([]);

    await expect(
      action.run({
        operation: "generate_brief",
        allowCreditRequest: true,
        arguments: {},
      }),
    ).resolves.toMatchObject({
      connected: false,
      creditRequests: 0,
      evidenceFallbackAction: "gong-calls",
      error: expect.stringContaining("No official Gong"),
    });
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });
});
