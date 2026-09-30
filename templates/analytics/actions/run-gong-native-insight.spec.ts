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

const { default: action } = await import("./run-gong-native-insight");

const askAccountTool = {
  serverId: "org_gong",
  name: "ask_account",
  description: "Ask Gong about an account",
  inputSchema: {
    type: "object",
    properties: { account: { type: "string" } },
  },
};

describe("run-gong-native-insight", () => {
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

  it("is a write, so MCP callers need write scope", () => {
    expect(action.readOnly).not.toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: false,
      requiresAuth: true,
    });
  });

  it("requires approval before an explicitly authorized paid request", () => {
    expect(typeof action.needsApproval).toBe("function");
    if (typeof action.needsApproval !== "function") return;

    expect(
      action.needsApproval({
        operation: "ask_account",
        allowCreditRequest: true,
      }),
    ).toBe(true);
    expect(
      action.needsApproval({
        operation: "ask_account",
        allowCreditRequest: false,
      }),
    ).toBe(false);
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
