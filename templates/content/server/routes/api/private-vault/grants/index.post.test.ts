import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeader = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const readBody = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../lib/private-vault-genesis-account-scope.js", () => ({
  resolveAuthenticatedPrivateVaultScope: (...args: unknown[]) =>
    resolveScope(...args),
}));
vi.mock("../../../../lib/private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) => readBody(...args),
}));
vi.mock("../../../../lib/private-vault-grants.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../lib/private-vault-grants.js")
  >()),
  privateVaultGrantService: { authorize, create },
}));

import handler from "./index.post.js";

const headers: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "content-type": "application/octet-stream",
  "content-length": "4",
  "x-anc-vault-id": "00112233445566778899aabbccddeeff",
  "x-anc-grant-id": "11112222333344445555666677778888",
  "x-anc-recipient-endpoint-id": "9999aaaabbbbccccddddeeeeffff0000",
  "x-anc-algorithm-id": "anc/v1",
  "x-anc-ciphertext-byte-length": "4",
  "x-anc-issued-at": "2026-07-18T12:00:00.000Z",
  "x-anc-expires-at": "2026-07-19T12:00:00.000Z",
};

describe("POST /api/private-vault/grants", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHeader.mockImplementation((_event, name: string) => headers[name]);
    resolveScope.mockResolvedValue({
      ownerEmail: "owner@example.com",
      orgId: "org:test",
      vaultId: headers["x-anc-vault-id"],
    });
    authorize.mockResolvedValue(undefined);
    readBody.mockResolvedValue(Uint8Array.from([1, 2, 3, 4]));
    create.mockResolvedValue({ grantId: headers["x-anc-grant-id"] });
  });

  it("authorizes scoped metadata before reading grant ciphertext", async () => {
    authorize.mockRejectedValue(new Error("no"));
    await expect(handler({} as never)).resolves.toEqual({
      error: "Not found",
    });
    expect(readBody).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts only exact bounded bytes after authorization", async () => {
    await expect(handler({} as never)).resolves.toEqual({
      grantId: headers["x-anc-grant-id"],
    });
    expect(authorize).toHaveBeenCalledBefore(readBody);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.com" }),
      expect.objectContaining({
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      }),
    );
  });
});
