import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestContext } from "../server/request-context.js";

const isOrgMemberMock = vi.fn();
vi.mock("../org/membership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/membership.js")>()),
  isOrgMember: (...args: unknown[]) => isOrgMemberMock(...args),
}));

const { checkCredentialOrgMembership } =
  await import("./credential-membership.js");

describe("checkCredentialOrgMembership", () => {
  beforeEach(() => {
    isOrgMemberMock.mockReset();
  });

  it("answers member or not-member from the live membership lookup", async () => {
    isOrgMemberMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const input = { orgId: "org-1", email: "alice@example.test" };

    await expect(checkCredentialOrgMembership(input)).resolves.toBe("member");
    await expect(checkCredentialOrgMembership(input)).resolves.toBe(
      "not-member",
    );
    expect(isOrgMemberMock).toHaveBeenCalledWith("org-1", "alice@example.test");
  });

  it("admits an org service identity for its own org without a lookup", async () => {
    await expect(
      checkCredentialOrgMembership({
        orgId: "Org_Mixed_Case",
        email: "svc-ci@service.Org_Mixed_Case",
      }),
    ).resolves.toBe("member");
    expect(isOrgMemberMock).not.toHaveBeenCalled();
  });

  it("looks up a service identity naming a different org like any other subject", async () => {
    isOrgMemberMock.mockResolvedValue(false);
    await expect(
      checkCredentialOrgMembership({
        orgId: "org-1",
        email: "svc-ci@service.org-2",
      }),
    ).resolves.toBe("not-member");
    expect(isOrgMemberMock).toHaveBeenCalledOnce();
  });

  it("refuses a credential with no subject without a lookup", async () => {
    await expect(
      checkCredentialOrgMembership({ orgId: "org-1", email: undefined }),
    ).resolves.toBe("not-member");
    expect(isOrgMemberMock).not.toHaveBeenCalled();
  });

  it("reports unavailable, not an answer, when the lookup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    isOrgMemberMock.mockRejectedValue(new Error("connection terminated"));
    await expect(
      checkCredentialOrgMembership({
        orgId: "org-1",
        email: "alice@example.test",
      }),
    ).resolves.toBe("unavailable");
    consoleError.mockRestore();
  });

  it("reports missing organization tables as unavailable, so nothing is revoked", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    isOrgMemberMock.mockRejectedValue(
      new Error('relation "org_members" does not exist'),
    );
    await expect(
      checkCredentialOrgMembership({
        orgId: "org-1",
        email: "alice@example.test",
      }),
    ).resolves.toBe("unavailable");
    consoleError.mockRestore();
  });

  it("runs the lookup with the app origin so federated orgs can be validated", async () => {
    let seenOrigin: string | undefined;
    isOrgMemberMock.mockImplementation(async () => {
      seenOrigin = getRequestContext()?.requestOrigin;
      return true;
    });
    await checkCredentialOrgMembership({
      orgId: "org-1",
      email: "alice@example.test",
      requestOrigin: "https://app.example.test",
    });
    expect(seenOrigin).toBe("https://app.example.test");
  });
});
