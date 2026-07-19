import { beforeEach, describe, expect, it, vi } from "vitest";

const append = vi.hoisted(() => vi.fn());
const loadState = vi.hoisted(() => vi.fn());
const loadEntry = vi.hoisted(() => vi.fn());
const claimRequestNonce = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/e2ee", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/e2ee")>();
  return {
    ...original,
    verifyEndpointRequestProofWithIdentity: async (input: {
      proof: { vaultId: string; endpointId: string };
      resolveAuthorizedEndpoint: (identity: {
        vaultId: string;
        endpointId: string;
      }) => Promise<unknown>;
      claimNonce: (claim: {
        vaultId: string;
        endpointId: string;
        nonce: string;
        expiresAt: string;
      }) => Promise<boolean>;
    }) => {
      const identity = await input.resolveAuthorizedEndpoint(input.proof);
      if (!identity) throw new Error("unauthorized endpoint");
      if (
        !(await input.claimNonce({
          vaultId: input.proof.vaultId,
          endpointId: input.proof.endpointId,
          nonce: "44".repeat(16),
          expiresAt: "2026-07-19T10:10:00.000Z",
        }))
      ) {
        throw new Error("replayed request");
      }
      return input.proof;
    },
  };
});

vi.mock("@agent-native/core/protected-ciphertext", () => ({
  putProtectedCiphertext: vi.fn(),
  readProtectedCiphertextAt: vi.fn(),
}));

vi.mock("./private-vault-ciphertext-staging.js", () => ({
  privateVaultCiphertextStagingService: { stage: vi.fn() },
  commitPrivateVaultCiphertextStageInTransaction: vi.fn(),
}));

vi.mock("./private-vault-control-log-runtime.js", () => ({
  resolveActivePrivateVaultControlScope: async () => ({
    ownerEmail: "owner@example.test",
    orgId: "org-continuity",
    vaultId: "11".repeat(16),
  }),
  authorizePrivateVaultGenesisCandidate: vi.fn(),
  privateVaultControlLogService: {
    append,
    loadVerifiedState: loadState,
    loadVerifiedEntry: loadEntry,
  },
}));

vi.mock("./private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: {
    claimAuthorizedControlRequest: (...args: unknown[]) =>
      claimRequestNonce(...args),
  },
}));

vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: () => {
    throw new Error("continuity append must not touch artifact tables");
  },
}));

import {
  ancV1BytesToHex,
  ancV1SigningKeypairFromSeed,
  createSignedControlLogEntry,
  decodeAncV1ControlLogContinuityAppendReceipt,
  encodeAncV1ControlLogContinuityAppendRequest,
  encodeSignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "@agent-native/core/e2ee";

import {
  appendPrivateVaultControlLogContinuity,
  PrivateVaultControlLogAppendError,
} from "./private-vault-control-log-append.js";

const vaultId = "11".repeat(16);
const endpointId = "22".repeat(16);
const issuedAt = "2026-07-19T10:00:00.000Z";

async function fixture(options?: {
  createdAt?: string;
  signerRole?: "endpoint" | "broker";
}) {
  const keys = await ancV1SigningKeypairFromSeed(
    Uint8Array.from({ length: 32 }, () => 0x31),
  );
  const signerRole = options?.signerRole ?? "endpoint";
  const state = {
    vaultId,
    sequence: 8,
    headHash: "33".repeat(32),
    membershipHash: "55".repeat(32),
    signedAt: "2026-07-18T01:00:00.000Z",
    activeMembers: [
      {
        endpointId,
        role: signerRole,
        unattended: signerRole === "broker",
        signingPublicKey: ancV1BytesToHex(keys.publicKey),
        keyAgreementPublicKey: "66".repeat(32),
        enrollmentRef: "77".repeat(16),
      },
    ],
    removedEndpointIds: [],
    epoch: 1,
    recoveryGeneration: 1,
    recoveryId: "88".repeat(16),
    recoverySigningPublicKey: "99".repeat(32),
    recoveryKeyAgreementPublicKey: "aa".repeat(32),
    recoveryWrapHash: "bb".repeat(32),
    freshnessMode: "endpoint_witnessed" as const,
  };
  const entry = await createSignedControlLogEntry({
    vaultId,
    createdAt: options?.createdAt ?? issuedAt,
    envelopeId: "cc".repeat(16),
    sequence: state.sequence + 1,
    previousHash: state.headHash,
    signerEndpointId: endpointId,
    signingPrivateKey: keys.privateKey,
    innerEnvelope: {
      suite: "anc/v1",
      type: "continuity_checkpoint",
      vaultId,
      membershipHash: state.membershipHash,
    },
  });
  const verified = await verifyAndReduceControlLogEntry({
    current: state,
    entry,
  });
  const signedEntry = encodeSignedControlLogEntry(entry);
  return {
    state,
    entry,
    signedEntry,
    verified,
    body: encodeAncV1ControlLogContinuityAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-continuity-append-request",
      signedEntry: Uint8Array.from(signedEntry),
    }),
  };
}

function proof() {
  return {
    version: 1 as const,
    suite: "anc/v1" as const,
    type: "endpoint_request" as const,
    vaultId,
    endpointId,
    method: "POST" as const,
    path: "/api/private-vault/control-log/append",
    bodyHash: "dd".repeat(32),
    issuedAt,
    nonce: "44".repeat(16),
    signature: "ee".repeat(64),
  };
}

describe("Private Vault endpoint-witnessed continuity append", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimRequestNonce.mockResolvedValue(true);
    append.mockResolvedValue(undefined);
  });

  it("renews a stale broker clock only through a currently active attended endpoint", async () => {
    const value = await fixture();
    loadState.mockResolvedValue(value.state);
    loadEntry.mockResolvedValue({
      entry: value.entry,
      state: value.verified.state,
      entryHash: value.verified.entryHash,
      prior: value.state,
    });

    const receipt = decodeAncV1ControlLogContinuityAppendReceipt(
      await appendPrivateVaultControlLogContinuity({
        body: value.body,
        proof: proof(),
        now: new Date(issuedAt),
      }),
    );

    expect(append).toHaveBeenCalledWith(expect.anything(), {
      entryBytes: value.signedEntry,
      expectedHead: { sequence: 8, hash: value.state.headHash },
    });
    expect(receipt).toMatchObject({
      vaultId,
      sequence: 9,
      headHash: value.verified.entryHash,
    });
  });

  it("rejects future-dated authority and broker-self-signed renewal", async () => {
    const future = await fixture({
      createdAt: "2026-07-19T10:00:31.000Z",
    });
    loadState.mockResolvedValue(future.state);
    await expect(
      appendPrivateVaultControlLogContinuity({
        body: future.body,
        proof: proof(),
        now: new Date(issuedAt),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const broker = await fixture({ signerRole: "broker" });
    loadState.mockResolvedValue(broker.state);
    await expect(
      appendPrivateVaultControlLogContinuity({
        body: broker.body,
        proof: proof(),
        now: new Date(issuedAt),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultControlLogAppendError);
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects an endpoint checkpoint built on a withheld non-current head", async () => {
    const value = await fixture();
    loadState.mockResolvedValue({
      ...value.state,
      sequence: 9,
      headHash: "ff".repeat(32),
    });
    loadEntry.mockRejectedValue(new Error("not committed"));

    await expect(
      appendPrivateVaultControlLogContinuity({
        body: value.body,
        proof: proof(),
        now: new Date(issuedAt),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(append).not.toHaveBeenCalled();
  });
});
