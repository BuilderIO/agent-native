import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveScope, readStatus, getRouterParam } = vi.hoisted(() => ({
  resolveScope: vi.fn(),
  readStatus: vi.fn(),
  getRouterParam: vi.fn(),
}));
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: vi.fn(),
  getRouterParam: (...args: unknown[]) => getRouterParam(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultBootstrapScope: resolveScope,
}));
vi.mock("../../../../../lib/private-vault-enrollment.js", async (original) => {
  const actual =
    await original<
      typeof import("../../../../../lib/private-vault-enrollment.js")
    >();
  return { ...actual, readPrivateVaultEnrollmentStatus: readStatus };
});

import handler from "./status.get.js";

describe("GET /api/private-vault/enrollment/:offerHash/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRouterParam.mockReturnValue("ab".repeat(32));
    resolveScope.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org-test",
      vaultId: "11".repeat(16),
    });
    readStatus.mockResolvedValue({
      phase: "challenge",
      offer: new Uint8Array([1, 2]),
      challenge: new Uint8Array([3, 4]),
      authorization: null,
      controlEntryId: null,
      controlEntryHash: null,
      expiresAt: "2026-07-18T18:10:00.000Z",
    });
  });

  it("returns only the authenticated byte-stable ceremony transcript", async () => {
    await expect(handler({} as never)).resolves.toEqual({
      version: 1,
      suite: "anc/v1",
      phase: "challenge",
      offer: "AQI",
      challenge: "AwQ",
      authorization: null,
      controlEntryId: null,
      controlEntryHash: null,
      expiresAt: "2026-07-18T18:10:00.000Z",
    });
    expect(readStatus).toHaveBeenCalledWith({
      scope: expect.objectContaining({ vaultId: "11".repeat(16) }),
      offerHash: "ab".repeat(32),
    });
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });

  it("fails closed before reading on malformed hashes or absent scope", async () => {
    getRouterParam.mockReturnValueOnce("not-a-hash");
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readStatus).not.toHaveBeenCalled();

    getRouterParam.mockReturnValueOnce("ab".repeat(32));
    resolveScope.mockResolvedValueOnce(null);
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(readStatus).not.toHaveBeenCalled();
  });
});
