import { describe, expect, it, vi } from "vitest";

import {
  createPrivateVaultGrantService,
  PrivateVaultGrantNotFoundError,
  type PrivateVaultGrantMetadata,
} from "./private-vault-grants.js";

const scope = {
  ownerEmail: "owner@example.com",
  orgId: "org:test",
  vaultId: "00112233445566778899aabbccddeeff",
};
const input = {
  vaultId: scope.vaultId,
  grantId: "11112222333344445555666677778888",
  recipientEndpointId: "9999aaaabbbbccccddddeeeeffff0000",
  algorithmId: "anc/v1" as const,
  ciphertextByteLength: 4,
  issuedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-19T12:00:00.000Z",
  ciphertext: Uint8Array.from([1, 2, 3, 4]),
};

describe("Private Vault grant service", () => {
  it("stages immutable ciphertext before committing scoped metadata", async () => {
    const calls: string[] = [];
    const stage = vi.fn(async () => {
      calls.push("stage");
      return { coordinate: { kind: "grant" } } as never;
    });
    const put = vi.fn(async () => {
      calls.push("put");
      return { created: true } as never;
    });
    const persist = vi.fn(async (_scope, grant: PrivateVaultGrantMetadata) => {
      calls.push("persist");
      return grant;
    });
    const service = createPrivateVaultGrantService({
      now: () => new Date("2026-07-18T12:00:01.000Z"),
      stage: {
        stage,
        clearAfterMetadataCommit: vi.fn(),
        reconcileExpired: vi.fn(),
      },
      put,
      store: { authorize: vi.fn(async () => true), persist },
    });
    await expect(service.create(scope, input)).resolves.toMatchObject({
      grantId: input.grantId,
      recipientEndpointId: input.recipientEndpointId,
      ciphertextByteLength: 4,
    });
    expect(calls).toEqual(["stage", "put", "persist"]);
    expect(stage).toHaveBeenCalledWith(scope, {
      kind: "grant",
      vaultId: scope.vaultId,
      grantId: input.grantId,
    });
  });

  it("fails closed before ciphertext I/O for invalid scope or lifetime", async () => {
    const put = vi.fn();
    const stage = vi.fn();
    const service = createPrivateVaultGrantService({
      now: () => new Date("2026-07-18T12:00:01.000Z"),
      stage: {
        stage,
        clearAfterMetadataCommit: vi.fn(),
        reconcileExpired: vi.fn(),
      },
      put,
      store: { authorize: vi.fn(async () => false), persist: vi.fn() },
    });
    await expect(service.create(scope, input)).rejects.toEqual(
      new PrivateVaultGrantNotFoundError(),
    );
    await expect(
      service.create(scope, {
        ...input,
        expiresAt: "2026-08-30T12:00:00.000Z",
      }),
    ).rejects.toEqual(new PrivateVaultGrantNotFoundError());
    expect(stage).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
