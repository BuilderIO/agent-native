import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute }),
}));

import { resolvePrivateVaultGenesisAccountScope } from "./private-vault-genesis-account-scope.js";

describe("Private Vault genesis account scope", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [{ role: "member" }] });
  });

  it("uses the stable Better Auth subject and organization, not email, as logical coordinates", async () => {
    const before = await resolvePrivateVaultGenesisAccountScope({
      userId: "stable-user-1",
      email: "before@example.test",
      orgId: "org-1",
    });
    const after = await resolvePrivateVaultGenesisAccountScope({
      userId: "stable-user-1",
      email: "after@example.test",
      orgId: "org-1",
    });
    expect(after?.accountId).toBe(before?.accountId);
    expect(after?.workspaceId).toBe(before?.workspaceId);
    expect(after?.ownerEmail).not.toBe(before?.ownerEmail);
  });

  it("changes account identity when an email is reassigned to another stable subject", async () => {
    const first = await resolvePrivateVaultGenesisAccountScope({
      userId: "stable-user-1",
      email: "same@example.test",
      orgId: "org-1",
    });
    const reassigned = await resolvePrivateVaultGenesisAccountScope({
      userId: "stable-user-2",
      email: "same@example.test",
      orgId: "org-1",
    });
    expect(reassigned?.accountId).not.toBe(first?.accountId);
  });

  it("fails closed when current Better Auth identity or org membership is absent", async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(
      resolvePrivateVaultGenesisAccountScope({
        userId: "revoked-user",
        email: "revoked@example.test",
        orgId: "org-removed",
      }),
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["revoked-user", "revoked@example.test", "org-removed"],
      }),
    );

    await expect(
      resolvePrivateVaultGenesisAccountScope({
        userId: "",
        email: "byoa@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBeNull();
  });
});
