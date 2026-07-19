import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
}));

const db = vi.hoisted(() => ({
  insert: vi.fn(() => ({
    values: vi.fn((row: Record<string, unknown>) => ({
      onConflictDoNothing: vi.fn(async () => {
        if (state.stored === null) state.stored = { ...row };
      }),
    })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => (state.stored ? [{ ...state.stored }] : [])),
      })),
    })),
  })),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => db,
  schema: {
    contentEncryptedVaultSignedDisclosures: {
      disclosureId: "disclosureId",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
      vaultId: "vaultId",
      serverReceivedAt: "serverReceivedAt",
    },
  },
}));

import {
  PrivateVaultSignedDisclosureConflictError,
  privateVaultSignedDisclosureService,
} from "./private-vault-signed-disclosures.js";

const principal = {
  ownerEmail: "owner@example.com",
  orgId: "org_12345678",
  vaultId: "11".repeat(16),
  endpointId: "22".repeat(16),
};

function disclosure(destination = "gpt-5.6") {
  return {
    version: 1 as const,
    suite: "anc/v1" as const,
    type: "broker-disclosure-request" as const,
    disclosureId: "33".repeat(16),
    vaultId: principal.vaultId,
    endpointId: principal.endpointId,
    jobId: "44".repeat(16),
    grantId: "55".repeat(16),
    grantRef: "66".repeat(32),
    resourceId: "77".repeat(16),
    operation: "get-document",
    providerId: "codex-cli",
    destination,
    outcome: "allowed" as const,
    scopeHash: "88".repeat(32),
    issuedAt: 1_721_131_200,
    expiresAt: 1_721_132_100,
    signedEnvelope: Uint8Array.of(0xa1, 0x01, 0x01),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.stored = null;
});

describe("Private Vault signed disclosure persistence", () => {
  it("stores only content-free signed evidence and accepts an exact retry", async () => {
    const first = await privateVaultSignedDisclosureService.append({
      principal,
      disclosure: disclosure(),
    });
    const replay = await privateVaultSignedDisclosureService.append({
      principal,
      disclosure: disclosure(),
    });

    expect(replay).toEqual(first);
    expect(state.stored).toMatchObject({
      disclosureId: "33".repeat(16),
      jobId: "44".repeat(16),
      resourceId: "77".repeat(16),
      operation: "get-document",
      providerId: "codex-cli",
      destination: "gpt-5.6",
      signedEnvelope: "oQEB",
    });
    expect(state.stored).not.toHaveProperty("content");
    expect(state.stored).not.toHaveProperty("plaintext");
  });

  it("fails closed when the same disclosure id changes destination", async () => {
    await privateVaultSignedDisclosureService.append({
      principal,
      disclosure: disclosure(),
    });
    await expect(
      privateVaultSignedDisclosureService.append({
        principal,
        disclosure: disclosure("another-model"),
      }),
    ).rejects.toEqual(new PrivateVaultSignedDisclosureConflictError());
  });
});
