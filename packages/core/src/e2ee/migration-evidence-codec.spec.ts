import { describe, expect, it } from "vitest";

import {
  decodeAncV1MigrationEvidence,
  decodeAncV1MigrationEvidenceResponse,
  encodeAncV1MigrationEvidence,
  encodeAncV1MigrationEvidenceResponse,
} from "./migration-evidence-codec.js";

const evidence = {
  version: 1 as const,
  suite: "anc/v1" as const,
  type: "migration-evidence" as const,
  kind: "recovery_drill" as const,
  vaultId: "11".repeat(16),
  migrationId: "22".repeat(16),
  exportId: "33".repeat(16),
  exportBundleHash: "44".repeat(32),
  plaintextHash: "55".repeat(32),
  sourceSnapshotHash: "66".repeat(32),
  objectCount: 2,
  recoveryDrillId: "77".repeat(16),
};

describe("anc/v1 migration evidence codec", () => {
  it("freezes the exact recovery evidence wire representation", () => {
    const encoded = encodeAncV1MigrationEvidence(evidence);
    expect(new TextDecoder().decode(encoded)).toBe(
      `{"version":1,"suite":"anc/v1","type":"migration-evidence","vaultId":"${"11".repeat(16)}","migrationId":"${"22".repeat(16)}","exportId":"${"33".repeat(16)}","exportBundleHash":"${"44".repeat(32)}","plaintextHash":"${"55".repeat(32)}","sourceSnapshotHash":"${"66".repeat(32)}","objectCount":2,"kind":"recovery_drill","recoveryDrillId":"${"77".repeat(16)}"}`,
    );
    expect(decodeAncV1MigrationEvidence(encoded)).toEqual(evidence);
  });

  it("rejects noncanonical or smuggled evidence", () => {
    const text = new TextDecoder().decode(
      encodeAncV1MigrationEvidence(evidence),
    );
    expect(() =>
      decodeAncV1MigrationEvidence(new TextEncoder().encode(` ${text}`)),
    ).toThrow("migration evidence is invalid");
    expect(() =>
      decodeAncV1MigrationEvidence(
        new TextEncoder().encode(text.replace(/}$/, ',"plaintext":"no"}')),
      ),
    ).toThrow("migration evidence is invalid");
  });

  it("round-trips the bounded content-free receipt", () => {
    const response = {
      version: 1 as const,
      suite: "anc/v1" as const,
      type: "migration-evidence-response" as const,
      kind: "recovery_drill" as const,
      state: "stored" as const,
      migrationId: evidence.migrationId,
      evidenceId: evidence.recoveryDrillId,
    };
    expect(
      decodeAncV1MigrationEvidenceResponse(
        encodeAncV1MigrationEvidenceResponse(response),
      ),
    ).toEqual(response);
  });
});
