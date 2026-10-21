import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute }),
}));

import searchAutomationAccounts from "./search-automation-accounts.js";

const ctx = {
  caller: "frontend" as const,
  userEmail: "owner@example.com",
  orgId: "org-1",
};

describe("search-automation-accounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is an authenticated bounded UI-only action", async () => {
    expect(searchAutomationAccounts.agentTool).toBe(false);
    expect(searchAutomationAccounts.http).toEqual({ method: "GET" });
    await expect(
      searchAutomationAccounts.run(
        { query: "al", limit: 10 },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      searchAutomationAccounts.run({ query: "a", limit: 10 }, ctx),
    ).rejects.toThrow();
    await expect(
      searchAutomationAccounts.run({ query: "alice", limit: 21 }, ctx),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns minimal existing-account fields and outside-organization labels", async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            email: "Member@Example.com",
            name: "Member",
            image: "https://example.com/member.png",
          },
          { email: "outside@example.com", name: "", image: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ email: "member@example.com" }] });

    await expect(
      searchAutomationAccounts.run({ query: "example", limit: 10 }, ctx),
    ).resolves.toEqual([
      {
        email: "member@example.com",
        name: "Member",
        avatar: "https://example.com/member.png",
        outsideOrganization: false,
      },
      {
        email: "outside@example.com",
        name: null,
        avatar: null,
        outsideOrganization: true,
      },
    ]);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      args: ["%example%", "%example%", 10],
    });
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      args: ["org-1", "member@example.com", "outside@example.com"],
    });
  });

  it("does not accept an organization id from the client", () => {
    expect(
      (
        searchAutomationAccounts.tool.parameters.properties as Record<
          string,
          unknown
        >
      ).orgId,
    ).toBeUndefined();
  });
});
