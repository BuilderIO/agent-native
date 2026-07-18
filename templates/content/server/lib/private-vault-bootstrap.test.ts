import { decodeAncV1VaultBootstrapResponse } from "@agent-native/core/e2ee";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadVerifiedSnapshot = vi.hoisted(() => vi.fn());
const loadVerifiedState = vi.hoisted(() => vi.fn());
const readProtectedCiphertextAt = vi.hoisted(() => vi.fn());
const bindingRows = vi.hoisted(() => [] as unknown[]);

vi.mock("./private-vault-control-log-runtime.js", () => ({
  privateVaultControlLogService: {
    loadVerifiedSnapshot,
    loadVerifiedState,
  },
}));

vi.mock("@agent-native/core/protected-ciphertext", () => ({
  readProtectedCiphertextAt,
}));

vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve(bindingRows), {
            limit: async () => bindingRows,
          }),
      }),
    }),
  }),
}));

import {
  PrivateVaultBootstrapError,
  readPrivateVaultBootstrapPage,
} from "./private-vault-bootstrap.js";

const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-bootstrap",
  vaultId: "vault-bootstrap-0001",
};
const state = {
  sequence: 1,
  headHash: "ab".repeat(32),
  recoveryWrapHash: "cd".repeat(32),
};
const entries = [
  {
    entryId: "entry-bootstrap-0",
    sequence: 0,
    entryHash: "01".repeat(32),
    entryBytes: Uint8Array.of(1),
  },
  {
    entryId: "entry-bootstrap-1",
    sequence: 1,
    entryHash: "02".repeat(32),
    entryBytes: Uint8Array.of(2, 3),
  },
];

describe("Private Vault bootstrap page", () => {
  beforeEach(() => {
    loadVerifiedSnapshot.mockReset();
    loadVerifiedState.mockReset();
    readProtectedCiphertextAt.mockReset();
    bindingRows.splice(0);
    loadVerifiedSnapshot.mockResolvedValue({ state, entries });
    loadVerifiedState.mockResolvedValue(state);
  });

  it("returns only a replay-verified public log page before the pinned head", async () => {
    const manyEntries = Array.from({ length: 9 }, (_, sequence) => ({
      entryId: `entry-bootstrap-${sequence}`,
      sequence,
      entryHash: sequence.toString(16).padStart(2, "0").repeat(32),
      entryBytes: Uint8Array.of(sequence),
    }));
    const manyState = { ...state, sequence: 8 };
    loadVerifiedSnapshot.mockResolvedValueOnce({
      state: manyState,
      entries: manyEntries,
    });
    loadVerifiedState.mockResolvedValueOnce(manyState);
    bindingRows.push({
      controlEntryId: manyEntries[0]!.entryId,
      recoveryWrapHash: "de".repeat(32),
      ciphertextByteLength: 2,
    });
    readProtectedCiphertextAt.mockResolvedValue({
      ciphertext: Uint8Array.of(4, 5),
    });
    const encoded = await readPrivateVaultBootstrapPage({
      scope,
      request: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-request",
        afterSequence: -1,
        expectedHead: null,
      },
    });
    const decoded = decodeAncV1VaultBootstrapResponse(encoded);
    expect(decoded.metadata).toMatchObject({
      afterSequence: -1,
      throughSequence: 7,
      head: { sequence: 8, hash: state.headHash },
      complete: false,
      recoveryWrapHash: null,
      recoveryWrapByteLength: 0,
    });
    expect(decoded.entries).toHaveLength(8);
    expect(decoded.entryRecoveryWraps).toEqual([
      Uint8Array.of(4, 5),
      ...Array(7).fill(null),
    ]);
    expect(decoded.recoveryWrap).toBeNull();
    expect(readProtectedCiphertextAt).toHaveBeenCalledWith({
      kind: "recovery-wrap",
      vaultId: scope.vaultId,
      recoveryWrapHash: "de".repeat(32),
    });
  });

  it("returns the exact current encrypted recovery wrap only on the final page", async () => {
    bindingRows.push({
      controlEntryId: entries[1]!.entryId,
      recoveryWrapHash: state.recoveryWrapHash,
      ciphertextByteLength: 3,
    });
    const stored = Uint8Array.of(7, 8, 9);
    readProtectedCiphertextAt.mockResolvedValue({ ciphertext: stored });
    const encoded = await readPrivateVaultBootstrapPage({
      scope,
      request: {
        version: 1,
        suite: "anc/v1",
        type: "vault-bootstrap-request",
        afterSequence: 0,
        expectedHead: { sequence: 1, hash: state.headHash },
      },
    });
    const decoded = decodeAncV1VaultBootstrapResponse(encoded);
    expect(decoded.metadata).toMatchObject({
      throughSequence: 1,
      complete: true,
      recoveryWrapHash: state.recoveryWrapHash,
      recoveryWrapByteLength: 3,
    });
    expect(decoded.entries).toEqual([Uint8Array.of(2, 3)]);
    expect(decoded.entryRecoveryWraps).toEqual([stored]);
    expect(decoded.recoveryWrap).toEqual(stored);
    expect(readProtectedCiphertextAt).toHaveBeenCalledWith({
      kind: "recovery-wrap",
      vaultId: scope.vaultId,
      recoveryWrapHash: state.recoveryWrapHash,
    });
  });

  it("fails closed on head substitution, noncontiguous rows, wrap mismatch, or a concurrent append", async () => {
    await expect(
      readPrivateVaultBootstrapPage({
        scope,
        request: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-request",
          afterSequence: 0,
          expectedHead: { sequence: 1, hash: "ff".repeat(32) },
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    loadVerifiedSnapshot.mockResolvedValueOnce({
      state,
      entries: [{ ...entries[0], sequence: 1 }],
    });
    await expect(
      readPrivateVaultBootstrapPage({
        scope,
        request: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-request",
          afterSequence: -1,
          expectedHead: null,
        },
      }),
    ).rejects.toBeInstanceOf(PrivateVaultBootstrapError);

    bindingRows.push({
      controlEntryId: entries[1]!.entryId,
      recoveryWrapHash: state.recoveryWrapHash,
      ciphertextByteLength: 4,
    });
    readProtectedCiphertextAt.mockResolvedValue({
      ciphertext: Uint8Array.of(1, 2, 3),
    });
    await expect(
      readPrivateVaultBootstrapPage({
        scope,
        request: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-request",
          afterSequence: 0,
          expectedHead: { sequence: 1, hash: state.headHash },
        },
      }),
    ).rejects.toMatchObject({ code: "unavailable" });

    bindingRows[0] = {
      controlEntryId: entries[1]!.entryId,
      recoveryWrapHash: state.recoveryWrapHash,
      ciphertextByteLength: 3,
    };
    loadVerifiedState.mockResolvedValueOnce({
      ...state,
      sequence: 2,
      headHash: "ee".repeat(32),
    });
    await expect(
      readPrivateVaultBootstrapPage({
        scope,
        request: {
          version: 1,
          suite: "anc/v1",
          type: "vault-bootstrap-request",
          afterSequence: 0,
          expectedHead: { sequence: 1, hash: state.headHash },
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
