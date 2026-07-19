import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveScope = vi.hoisted(() => vi.fn());
const loadVerifiedState = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultBootstrapScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../lib/private-vault-control-log-runtime.js", () => ({
  privateVaultControlLogService: { loadVerifiedState },
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));

import handler from "./runtime.get";

describe("GET /api/private-vault/runtime", () => {
  beforeEach(() => vi.resetAllMocks());

  it("discovers an authenticated vault without requiring a broker", async () => {
    const scope = {
      ownerEmail: "owner@example.test",
      orgId: "org:test",
      vaultId: "11".repeat(16),
    };
    resolveScope.mockResolvedValue(scope);
    loadVerifiedState.mockResolvedValue({
      sequence: 7,
      headHash: "22".repeat(32),
      activeMembers: [],
    });
    await expect(handler({} as never)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      state: "active",
      vaultId: scope.vaultId,
      head: { sequence: 7, hash: "22".repeat(32) },
    });
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });

  it("does not disclose whether another vault exists", async () => {
    resolveScope.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(loadVerifiedState).not.toHaveBeenCalled();
  });
});
