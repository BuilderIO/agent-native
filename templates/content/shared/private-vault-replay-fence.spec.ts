import { describe, expect, it } from "vitest";

import {
  CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT,
  privateVaultReplayFenceRecordSchema,
} from "./private-vault-replay-fence.js";

const record = {
  version: 1 as const,
  vaultId: "vault:replay-fence",
  endpointId: "endpoint:replay-fence",
  nonceDigest: "ab".repeat(32),
  claimedAtBucket: Date.parse("2026-07-17T02:00:00.000Z"),
  expiresAtBucket: Date.parse("2026-07-17T02:06:00.000Z"),
};

describe("Content Private Vault operational replay-fence contract", () => {
  it("freezes only digests and minute-resolution content-free timing", () => {
    expect(privateVaultReplayFenceRecordSchema.parse(record)).toEqual(record);
    expect(CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT.logicalFields).toEqual(
      Object.keys(record),
    );
    expect(CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT.timingResolutionMs).toBe(
      60_000,
    );
    expect(
      CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT.approvedRoutingAliases,
    ).toEqual(["ownerEmail", "orgId"]);
    expect(
      CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT.backupPurgeMaximumDays,
    ).toBe(35);
  });

  it.each([
    { ...record, nonce: "raw-request-nonce" },
    { ...record, signature: "forbidden" },
    { ...record, claimedAtBucket: record.claimedAtBucket + 1 },
    {
      ...record,
      expiresAtBucket: record.claimedAtBucket + 9 * 60_000,
    },
  ])("rejects raw or over-precise operational metadata", (candidate) => {
    expect(() =>
      privateVaultReplayFenceRecordSchema.parse(candidate),
    ).toThrow();
  });
});
