import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requestContext: undefined as
    | { userEmail?: string; orgId?: string; a2aIdentityAssurance?: string }
    | undefined,
  role: "member" as string | null,
  readOrgMemberRole: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => state.requestContext?.orgId ?? null,
  getRequestUserEmail: () => state.requestContext?.userEmail ?? null,
  readOrgMemberRole: state.readOrgMemberRole,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => state.requestContext,
  getRequestOrgId: () => state.requestContext?.orgId ?? null,
  getRequestUserEmail: () => state.requestContext?.userEmail ?? null,
}));

vi.mock("./brain.js", () => ({
  nanoid: () => "test-id",
  nowIso: () => "2026-10-21T00:00:00.000Z",
  stableJson: JSON.stringify,
}));

vi.mock("./zoom.js", () => ({
  zoomApprovedMeetingIds: () => new Set<string>(),
}));

vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

state.readOrgMemberRole.mockImplementation(async () => state.role);

const { isBrainAdmin } = await import("./zoom-governance.js");

describe("isBrainAdmin delegated identity", () => {
  it("does not grant stored admin authority to an org-member identity", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.role = "member";
    state.readOrgMemberRole.mockClear();

    await expect(isBrainAdmin("member@example.com", "org-1")).resolves.toBe(
      false,
    );
    expect(state.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "member@example.com",
    );
  });

  it("rejects a caller-supplied email or org mismatch before role lookup", async () => {
    state.requestContext = {
      userEmail: "member@example.com",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member",
    };
    state.role = "admin";
    state.readOrgMemberRole.mockClear();

    await expect(isBrainAdmin("other@example.com", "org-1")).resolves.toBe(
      false,
    );
    await expect(isBrainAdmin("member@example.com", "org-2")).resolves.toBe(
      false,
    );
    expect(state.readOrgMemberRole).not.toHaveBeenCalled();
  });
});
