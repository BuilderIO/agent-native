import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: undefined as string | undefined,
  list: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.email,
}));
vi.mock("../server/model/pending-workspace-invites.js", () => ({
  listPendingWorkspaceInvites: mocks.list,
}));

import action from "./list-pending-workspace-invites";

describe("list-pending-workspace-invites", () => {
  beforeEach(() => mocks.list.mockReset());

  it("lists invitations for the signed-in account's email only", async () => {
    mocks.email = "invitee@example.test";
    mocks.list.mockResolvedValue([
      { id: "i1", orgId: "o1", orgName: "Acme", invitedBy: "a@b.test" },
    ]);
    const result = await action.run({}, {} as never);
    expect(mocks.list).toHaveBeenCalledWith("invitee@example.test");
    expect(result.invitations).toHaveLength(1);
  });

  it("returns nothing for an unknown caller", async () => {
    mocks.email = undefined;
    mocks.list.mockResolvedValue([]);
    await expect(action.run({}, {} as never)).resolves.toEqual({
      invitations: [],
    });
  });
});
