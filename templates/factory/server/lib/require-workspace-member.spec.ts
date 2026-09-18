import { orgMembers, resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db/index.js";
import { requireWorkspaceMember } from "./require-workspace-member.js";

vi.mock("@agent-native/core/org", () => ({
  orgMembers: {
    email: "email",
    orgId: "org_id",
    role: "role",
  },
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
}));

const mockedGetDb = vi.mocked(getDb);
const mockedResolveOrgIdForEmail = vi.mocked(resolveOrgIdForEmail);
const mockedGetRequestOrgId = vi.mocked(getRequestOrgId);
const mockedGetRequestUserEmail = vi.mocked(getRequestUserEmail);

function mockMember(role = "owner") {
  const limit = vi.fn().mockResolvedValue([{ role }]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  mockedGetDb.mockReturnValue({
    select: vi.fn().mockReturnValue({ from }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetRequestUserEmail.mockReturnValue(undefined);
  mockedGetRequestOrgId.mockReturnValue(undefined);
  mockedResolveOrgIdForEmail.mockResolvedValue(null);
});

describe("requireWorkspaceMember", () => {
  it("accepts an explicit scheduler identity without request context", async () => {
    mockMember();

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
  });

  it("continues to resolve identity from request context for HTTP callers", async () => {
    mockedGetRequestUserEmail.mockReturnValue("Member@Example.com");
    mockedGetRequestOrgId.mockReturnValue("org-2");
    mockMember("member");

    await expect(requireWorkspaceMember()).resolves.toEqual({
      userEmail: "member@example.com",
      orgId: "org-2",
      role: "member",
    });
  });

  it("fails clearly when neither an explicit nor request identity exists", async () => {
    await expect(requireWorkspaceMember()).rejects.toThrow(
      "Authentication required",
    );
  });
});
