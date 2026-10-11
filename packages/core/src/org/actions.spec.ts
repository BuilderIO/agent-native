import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../db/client.js", () => ({ getDbExec: () => ({ execute }) }));

import { ActionContractError } from "../action.js";
import { requireOrgMember } from "./actions.js";

const member = { userEmail: "member@example.test", orgId: "org-test" };

describe("requireOrgMember", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [{ role: "member" }] });
  });

  it.each([
    undefined,
    {},
    { ...member, userEmail: " " },
    { ...member, orgId: " " },
  ])("returns a typed 401 when identity is incomplete: %j", async (ctx) => {
    await expect(requireOrgMember(ctx)).rejects.toMatchObject({
      name: "ActionContractError",
      statusCode: 401,
      errorCode: "unauthorized",
      message: "An authenticated organization member is required.",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a typed 403 for a non-member", async () => {
    execute.mockResolvedValue({ rows: [] });
    await expect(requireOrgMember(member)).rejects.toMatchObject({
      name: "ActionContractError",
      statusCode: 403,
      errorCode: "forbidden",
      message: "You are not a member of the active organization.",
    });
  });

  it("returns a typed 403 for a member requesting admin access", async () => {
    await expect(requireOrgMember(member, true)).rejects.toMatchObject({
      name: "ActionContractError",
      statusCode: 403,
      errorCode: "forbidden",
      message: "Organization admin role required.",
    });
  });

  it.each(["owner", "admin"])("accepts %s for admin access", async (role) => {
    execute.mockResolvedValue({ rows: [{ role }] });
    await expect(requireOrgMember(member, true)).resolves.toEqual({
      email: member.userEmail,
      orgId: member.orgId,
    });
  });

  it("accepts and trims a member's identity for ordinary access", async () => {
    await expect(
      requireOrgMember({
        userEmail: ` ${member.userEmail} `,
        orgId: ` ${member.orgId} `,
      }),
    ).resolves.toEqual({
      email: member.userEmail,
      orgId: member.orgId,
    });
    expect(execute.mock.calls[0][0]).toMatchObject({
      sql: expect.stringContaining("federation_removal_pending_at IS NULL"),
      args: [member.orgId, member.userEmail],
    });
  });

  it("preserves unexpected lookup failures", async () => {
    const error = new Error("database unavailable");
    execute.mockRejectedValue(error);
    await expect(requireOrgMember(member, true)).rejects.toBe(error);
    expect(error).not.toBeInstanceOf(ActionContractError);
  });
});
