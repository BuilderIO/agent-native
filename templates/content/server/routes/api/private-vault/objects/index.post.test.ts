import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const authorizePut = vi.hoisted(() => vi.fn());
const putRevision = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...args: unknown[]) =>
    getSession(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) =>
    readPrivateVaultBoundedBody(...args),
}));
vi.mock("../../../../lib/private-vault-objects.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../lib/private-vault-objects.js")
    >();
  return {
    ...actual,
    privateVaultObjectService: { authorizePut, putRevision },
  };
});

import { PrivateVaultObjectNotFoundError } from "../../../../lib/private-vault-objects.js";
import handler from "./index.post";

const headers: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/octet-stream",
  "content-length": "4",
  "x-anc-vault-id": "vault:test-0001",
  "x-anc-object-id": "object:test-0001",
  "x-anc-revision-id": "revision:test-0001",
  "x-anc-object-type": "document",
  "x-anc-algorithm-id": "anc/v1",
  "x-anc-epoch": "1",
  "x-anc-ciphertext-byte-length": "4",
};

describe("POST /api/private-vault/objects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    getSession.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org:test-0001",
      vaultId: "vault:test-0001",
    });
    authorizePut.mockResolvedValue(undefined);
    readPrivateVaultBoundedBody.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    putRevision.mockResolvedValue({ revisionId: "revision:test-0001" });
  });

  it("checks same-origin CSRF before session or body access", async () => {
    getHeader.mockReturnValue(undefined);
    await expect(handler({} as never)).resolves.toEqual({
      error: "Request unavailable",
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(getSession).not.toHaveBeenCalled();
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
  });

  it("authorizes the exact vault/object scope before reading ciphertext", async () => {
    authorizePut.mockRejectedValue(new PrivateVaultObjectNotFoundError());
    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(authorizePut).toHaveBeenCalledWith(
      {
        ownerEmail: "owner@example.test",
        orgId: "org:test-0001",
        vaultId: "vault:test-0001",
      },
      expect.objectContaining({
        objectId: "object:test-0001",
        revisionId: "revision:test-0001",
      }),
    );
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
    expect(putRevision).not.toHaveBeenCalled();
  });

  it("returns the uniform not-found response when no session exists", async () => {
    getSession.mockResolvedValue(null);

    await expect(handler({} as never)).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(authorizePut).not.toHaveBeenCalled();
    expect(readPrivateVaultBoundedBody).not.toHaveBeenCalled();
    expect(putRevision).not.toHaveBeenCalled();
  });

  it("accepts exact octet-stream bytes and returns no provider details", async () => {
    const result = await handler({} as never);
    expect(readPrivateVaultBoundedBody).toHaveBeenCalledWith(
      expect.anything(),
      4,
      256 * 1024 * 1024,
    );
    expect(putRevision).toHaveBeenCalledWith(
      expect.objectContaining({ vaultId: "vault:test-0001" }),
      expect.objectContaining({
        ciphertext: new Uint8Array([1, 2, 3, 4]),
        ciphertextByteLength: 4,
      }),
    );
    expect(result).toEqual({ revisionId: "revision:test-0001" });
    expect(JSON.stringify(result)).not.toContain("provider");
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });
});
