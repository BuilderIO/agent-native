import { describe, expect, it, vi } from "vitest";

import { lockOrgMembersForMutation } from "./member-mutation-locks.js";

describe("lockOrgMembersForMutation", () => {
  it("locks normalized actor and target rows by id order", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "actor-1",
          email: "Owner@Example.test",
          role: "owner",
          federationRemovalPendingAt: null,
        },
        {
          id: "member-1",
          email: "member@example.test",
          role: "member",
          federationRemovalPendingAt: 1,
        },
      ],
      rowsAffected: 0,
    });

    await expect(
      lockOrgMembersForMutation({ execute }, "org-1", [
        " OWNER@example.test ",
        "member@example.test",
        "owner@example.test",
      ]),
    ).resolves.toEqual([
      {
        id: "actor-1",
        email: "Owner@Example.test",
        role: "owner",
        federationRemovalPendingAt: null,
      },
      {
        id: "member-1",
        email: "member@example.test",
        role: "member",
        federationRemovalPendingAt: 1,
      },
    ]);
    expect(execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("ORDER BY id FOR UPDATE"),
      args: ["org-1", "owner@example.test", "member@example.test"],
    });
  });

  it("avoids a lock query without actor or target email", async () => {
    const execute = vi.fn();

    await expect(
      lockOrgMembersForMutation({ execute }, "org-1", [" "]),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
