import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeader = vi.hoisted(() => vi.fn());
const getRouterParam = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const revoke = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  getRouterParam: (...args: unknown[]) => getRouterParam(...args),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));
vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../../lib/private-vault-grants.js", () => ({
  privateVaultGrantService: { revoke },
}));

import handler from "./[grantId].delete.js";

const vaultId = "00112233445566778899aabbccddeeff";
const grantId = "11112222333344445555666677778888";

describe("DELETE /api/private-vault/grants/:grantId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) =>
      name === "x-anc-vault-id" ? vaultId : "1",
    );
    getRouterParam.mockReturnValue(grantId);
    resolveScope.mockResolvedValue({
      ownerEmail: "owner@example.com",
      orgId: "org:test",
      vaultId,
    });
    revoke.mockResolvedValue({ vaultId, grantId, state: "revoked" });
  });

  it("revokes only within the authenticated vault scope", async () => {
    await expect(handler({} as never)).resolves.toEqual({
      vaultId,
      grantId,
      state: "revoked",
    });
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.com", vaultId }),
      grantId,
    );
  });

  it("hides an unauthorized vault as not found", async () => {
    resolveScope.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(revoke).not.toHaveBeenCalled();
  });
});
