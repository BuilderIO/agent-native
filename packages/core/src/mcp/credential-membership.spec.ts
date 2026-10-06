import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestContext } from "../server/request-context.js";

const executeMock = vi.hoisted(() => vi.fn());
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));

const { checkCredentialOrgMembership } =
  await import("./credential-membership.js");

describe("checkCredentialOrgMembership", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async ({ sql }: { sql: string }) => ({
      rows: sql.includes("FROM org_members")
        ? [{ role: "member", federation_removal_pending_at: null }]
        : [{ identity_authority: null, identity_id: null }],
    }));
  });

  it("answers member or not-member from the live membership lookup", async () => {
    const input = { orgId: "org-1", email: "alice@example.test" };

    await expect(checkCredentialOrgMembership(input)).resolves.toBe("member");
    executeMock.mockResolvedValue({ rows: [] });
    await expect(checkCredentialOrgMembership(input)).resolves.toBe(
      "not-member",
    );
    expect(executeMock).toHaveBeenCalledWith({
      sql: expect.stringContaining("FROM org_members"),
      args: ["org-1", "alice@example.test"],
    });
  });

  it("admits an authenticated stored org service token without a membership lookup", async () => {
    await expect(
      checkCredentialOrgMembership({
        orgId: "Org_Mixed_Case",
        email: "svc-ci@service.Org_Mixed_Case",
        storedConnectToken: {
          kind: "service",
          ownerEmail: "svc-ci@service.Org_Mixed_Case",
          orgId: "Org_Mixed_Case",
        },
      }),
    ).resolves.toBe("member");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {
      kind: "personal" as const,
      ownerEmail: "svc-ci@service.org-1",
      orgId: "org-1",
    },
    {
      kind: "service" as const,
      ownerEmail: "svc-other@service.org-1",
      orgId: "org-1",
    },
    {
      kind: "service" as const,
      ownerEmail: "svc-ci@service.org-1",
      orgId: "org-2",
    },
  ])(
    "checks a service-shaped human subject without matching stored service provenance: %j",
    async (storedConnectToken) => {
      executeMock.mockResolvedValue({ rows: [] });
      await expect(
        checkCredentialOrgMembership({
          orgId: "org-1",
          email: "svc-ci@service.org-1",
          storedConnectToken,
        }),
      ).resolves.toBe("not-member");
      expect(executeMock).toHaveBeenCalledOnce();
    },
  );

  it("looks up a service identity naming a different org like any other subject", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    await expect(
      checkCredentialOrgMembership({
        orgId: "org-1",
        email: "svc-ci@service.org-2",
        storedConnectToken: {
          kind: "service",
          ownerEmail: "svc-ci@service.org-2",
          orgId: "org-1",
        },
      }),
    ).resolves.toBe("not-member");
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("refuses a credential with no subject without a lookup", async () => {
    await expect(
      checkCredentialOrgMembership({ orgId: "org-1", email: undefined }),
    ).resolves.toBe("not-member");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("reports unavailable, not an answer, when the lookup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    executeMock.mockRejectedValue(new Error("connection terminated"));
    await expect(
      checkCredentialOrgMembership({
        orgId: "org-1",
        email: "alice@example.test",
      }),
    ).resolves.toBe("unavailable");
    consoleError.mockRestore();
  });

  it.each(["org_members", "organizations"])(
    "reports a missing %s table through the real membership helper as unavailable",
    async (table) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      executeMock.mockImplementation(async ({ sql }: { sql: string }) => {
        if (sql.includes(`FROM ${table}`)) {
          throw new Error(`relation "${table}" does not exist`);
        }
        return { rows: [{ role: "member" }] };
      });
      await expect(
        checkCredentialOrgMembership({
          orgId: "org-1",
          email: "alice@example.test",
        }),
      ).resolves.toBe("unavailable");
      consoleError.mockRestore();
    },
  );

  it("runs the lookup with the app origin so federated orgs can be validated", async () => {
    let seenOrigin: string | undefined;
    executeMock.mockImplementation(async () => {
      seenOrigin = getRequestContext()?.requestOrigin;
      return { rows: [] };
    });
    await checkCredentialOrgMembership({
      orgId: "org-1",
      email: "alice@example.test",
      requestOrigin: "https://app.example.test",
    });
    expect(seenOrigin).toBe("https://app.example.test");
  });
});
