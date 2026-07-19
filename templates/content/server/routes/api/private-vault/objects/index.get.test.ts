import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveScope = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const listObjects = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-objects.js", () => ({
  PrivateVaultObjectNotFoundError: class extends Error {},
  privateVaultObjectService: { listObjects },
}));

import handler from "./index.get";

describe("GET /api/private-vault/objects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockReturnValue("vault:test-0001");
  });

  it("returns only authenticated content-free object coordinates", async () => {
    const scope = {
      ownerEmail: "owner@example.test",
      orgId: "org:test-0001",
      vaultId: "vault:test-0001",
    };
    resolveScope.mockResolvedValue(scope);
    listObjects.mockResolvedValue([
      {
        objectId: "object:test-0001",
        objectType: "document",
        latestRevision: {
          vaultId: scope.vaultId,
          objectId: "object:test-0001",
          revisionId: "revision:test-0001",
          revision: 1,
          objectType: "document",
          algorithmId: "anc/v1",
          epoch: 1,
          parentRevisionIds: [],
          ciphertextByteLength: 400,
          serverReceivedAt: "2026-07-18T12:00:00.000Z",
        },
      },
    ]);

    const result = await handler({} as never);

    expect(result).toEqual({ objects: expect.any(Array) });
    expect(listObjects).toHaveBeenCalledWith(scope);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("title");
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain('ciphertext":');
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });

  it("uses the same not-found shape before exposing whether a vault exists", async () => {
    resolveScope.mockResolvedValue(null);

    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(listObjects).not.toHaveBeenCalled();
  });
});
