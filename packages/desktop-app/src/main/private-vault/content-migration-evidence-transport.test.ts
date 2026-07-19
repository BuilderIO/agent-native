import {
  decodeAncV1MigrationEvidence,
  encodeAncV1MigrationEvidenceResponse,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH,
  PrivateVaultMigrationEvidenceTransport,
  PrivateVaultMigrationEvidenceTransportError,
} from "./content-migration-evidence-transport.js";

const vaultId = "11".repeat(16);
const migrationId = "22".repeat(16);
const exportId = "33".repeat(16);
const evidence = {
  version: 1 as const,
  suite: "anc/v1" as const,
  type: "migration-evidence" as const,
  kind: "export" as const,
  vaultId,
  migrationId,
  exportId,
  exportBundleHash: "44".repeat(32),
  plaintextHash: "55".repeat(32),
  sourceSnapshotHash: "66".repeat(32),
  objectCount: 2,
};

function fixture(responseOverride?: Partial<Response>) {
  let capturedBody: Uint8Array | undefined;
  const responseBytes = encodeAncV1MigrationEvidenceResponse({
    version: 1,
    suite: "anc/v1",
    type: "migration-evidence-response",
    kind: "export",
    state: "stored",
    migrationId,
    evidenceId: exportId,
  });
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    capturedBody = Uint8Array.from(init.body as Uint8Array);
    return {
      status: 200,
      url: `https://content.example.test${PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH}`,
      redirected: false,
      headers: new Headers({
        "content-type": "application/octet-stream",
        "content-length": String(responseBytes.byteLength),
      }),
      arrayBuffer: async () => responseBytes.slice().buffer,
      ...responseOverride,
    } as Response;
  });
  const native = {
    listVaultMembers: vi.fn(async () => ({
      members: [
        {
          endpointId: "77".repeat(16),
          role: "endpoint" as const,
          unattended: false,
          current: true,
        },
      ],
    })),
    signEndpointRequest: vi.fn(async () => ({
      signature: Uint8Array.from({ length: 64 }, () => 0x88),
    })),
  };
  return {
    fetch,
    native,
    capturedBody: () => capturedBody,
    transport: new PrivateVaultMigrationEvidenceTransport({
      origin: "https://content.example.test",
      session: { fetch },
      native: native as never,
      now: () => new Date("2026-07-19T10:00:00.000Z"),
      nonce: () => "99".repeat(32),
    }),
  };
}

describe("signed Desktop migration evidence transport", () => {
  it("signs the canonical evidence body as the current attended endpoint", async () => {
    const source = fixture();
    await expect(source.transport.append(evidence)).resolves.toMatchObject({
      kind: "export",
      evidenceId: exportId,
    });
    expect(source.native.signEndpointRequest).toHaveBeenCalledOnce();
    const request = source.fetch.mock.calls[0]![1]!;
    expect(request.credentials).toBe("include");
    expect(
      (request.headers as Record<string, string>)["X-Anc-Endpoint-Proof"],
    ).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAncV1MigrationEvidence(source.capturedBody()!)).toEqual(
      evidence,
    );
  });

  it("fails closed for a redirected or noncanonical response", async () => {
    const source = fixture({ redirected: true });
    await expect(source.transport.append(evidence)).rejects.toBeInstanceOf(
      PrivateVaultMigrationEvidenceTransportError,
    );
  });
});
