import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOrgMemberRole: vi.fn(async () => "member"),
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: mocks.readOrgMemberRole,
  refreshMcpManagerForPrincipal: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/mcp", () => ({ fetchOrgApps: vi.fn() }));

vi.mock("@agent-native/core/mcp-client", () => ({
  addFirstPartyRemoteServer: vi.fn(),
  isFirstPartyRemoteEndpointTrusted: vi.fn(),
  listRemoteServers: vi.fn(),
  removeRemoteServer: vi.fn(),
}));

import action from "./connect-assets-mcp.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOrgMemberRole.mockResolvedValue("member");
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
});

describe("connect-assets-mcp org role gate", () => {
  it("denies an org-member assertion for a stored owner before changing MCP config", async () => {
    await expect(action.run({} as never)).rejects.toThrow(
      "Only organization owners and admins can connect org-scoped MCP servers.",
    );
    expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
    );
  });

  it.each([
    { orgId: "org-1", userEmail: "other@example.com" },
    { orgId: "org-2", userEmail: "owner@example.com" },
  ])(
    "fails closed on a delegated identity mismatch when role resolution rejects it: %o",
    async (identity) => {
      mocks.getRequestOrgId.mockReturnValue(identity.orgId);
      mocks.getRequestUserEmail.mockReturnValue(identity.userEmail);
      mocks.readOrgMemberRole.mockResolvedValue(null);

      await expect(action.run({} as never)).rejects.toThrow(
        "Only organization owners and admins can connect org-scoped MCP servers.",
      );
      expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
        identity.orgId,
        identity.userEmail,
      );
    },
  );
});
