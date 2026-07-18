import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveScope, loadVerifiedState } = vi.hoisted(() => ({
  resolveScope: vi.fn(),
  loadVerifiedState: vi.fn(),
}));
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));

vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultBootstrapScope: resolveScope,
}));
vi.mock("../../../../lib/private-vault-control-log-runtime.js", () => ({
  privateVaultControlLogService: { loadVerifiedState },
}));

import handler from "./runtime.get.js";

describe("GET /api/private-vault/broker/runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveScope.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org_12345678",
      vaultId: "00112233445566778899aabbccddeeff",
    });
    loadVerifiedState.mockResolvedValue({
      sequence: 7,
      headHash: "ab".repeat(32),
      activeMembers: [
        {
          endpointId: "11112222333344445555666677778888",
          role: "broker",
          unattended: true,
        },
      ],
    });
  });

  it("returns only authenticated public runtime coordinates", async () => {
    const event = {} as never;
    await expect(handler(event)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      state: "active",
      vaultId: "00112233445566778899aabbccddeeff",
      endpointId: "11112222333344445555666677778888",
      head: { sequence: 7, hash: "ab".repeat(32) },
    });
    expect(loadVerifiedState).toHaveBeenCalledWith(
      expect.objectContaining({ vaultId: "00112233445566778899aabbccddeeff" }),
    );
  });

  it("fails closed without account scope or exactly one active broker", async () => {
    const event = {} as never;
    resolveScope.mockResolvedValueOnce(null);
    await expect(handler(event)).resolves.toEqual({ error: "Not found" });

    resolveScope.mockResolvedValueOnce({
      ownerEmail: "owner@example.test",
      orgId: "org_12345678",
      vaultId: "00112233445566778899aabbccddeeff",
    });
    loadVerifiedState.mockResolvedValueOnce({
      sequence: 7,
      headHash: "ab".repeat(32),
      activeMembers: [],
    });
    await expect(handler(event)).resolves.toEqual({
      error: "Request unavailable",
    });
  });
});
