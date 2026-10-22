import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { readOrgMemberRole } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireWorkspaceMember } from "./require-workspace-member.js";

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  readOrgMemberRole: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

const mockedResolveOrgIdForEmail = vi.mocked(resolveOrgIdForEmail);
const mockedGetRequestOrgId = vi.mocked(getRequestOrgId);
const mockedGetRequestUserEmail = vi.mocked(getRequestUserEmail);
const mockedReadOrgMemberRole = vi.mocked(readOrgMemberRole);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetRequestUserEmail.mockReturnValue(undefined);
  mockedGetRequestOrgId.mockReturnValue(undefined);
  mockedResolveOrgIdForEmail.mockResolvedValue(null);
  mockedReadOrgMemberRole.mockResolvedValue("owner");
});

describe("requireWorkspaceMember", () => {
  it("accepts an explicit scheduler identity without request context", async () => {
    await expect(
      requireWorkspaceMember({
        userEmail: "Owner@Example.com",
        orgId: "org-1",
      }),
    ).resolves.toEqual({
      userEmail: "owner@example.com",
      orgId: "org-1",
      role: "owner",
    });

    expect(mockedGetRequestUserEmail).not.toHaveBeenCalled();
    expect(mockedGetRequestOrgId).not.toHaveBeenCalled();
    expect(mockedResolveOrgIdForEmail).not.toHaveBeenCalled();
    expect(mockedReadOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "owner@example.com",
    );
  });

  it("continues to resolve identity from request context for HTTP callers", async () => {
    mockedGetRequestUserEmail.mockReturnValue("Member@Example.com");
    mockedGetRequestOrgId.mockReturnValue("org-2");
    mockedReadOrgMemberRole.mockResolvedValue("member");

    await expect(requireWorkspaceMember()).resolves.toEqual({
      userEmail: "member@example.com",
      orgId: "org-2",
      role: "member",
    });
  });

  it("uses the effective member role for a delegated organization owner", async () => {
    mockedGetRequestUserEmail.mockReturnValue("Owner@Example.com");
    mockedGetRequestOrgId.mockReturnValue("org-2");
    mockedReadOrgMemberRole.mockResolvedValue("member");

    await expect(requireWorkspaceMember()).resolves.toEqual({
      userEmail: "owner@example.com",
      orgId: "org-2",
      role: "member",
    });
  });

  it.each([
    { userEmail: "other@example.com", orgId: "org-1" },
    { userEmail: "owner@example.com", orgId: "org-2" },
  ])(
    "denies a delegated explicit identity mismatch when role resolution rejects it: %o",
    async (identity) => {
      mockedGetRequestUserEmail.mockReturnValue("owner@example.com");
      mockedGetRequestOrgId.mockReturnValue("org-1");
      mockedReadOrgMemberRole.mockResolvedValue(null);

      await expect(requireWorkspaceMember(identity)).rejects.toThrow(
        "Workspace membership required",
      );
      expect(mockedReadOrgMemberRole).toHaveBeenCalledWith(
        identity.orgId,
        identity.userEmail,
      );
    },
  );

  it("fails clearly when neither an explicit nor request identity exists", async () => {
    await expect(requireWorkspaceMember()).rejects.toThrow(
      "Authentication required",
    );
  });
});
