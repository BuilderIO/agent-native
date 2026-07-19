import {
  decodeAncV1MigrationEvidenceResponse,
  encodeAncV1MigrationEvidence,
} from "@agent-native/core/e2ee";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const readBody = vi.hoisted(() => vi.fn());
const decodeProof = vi.hoisted(() => vi.fn());
const authenticate = vi.hoisted(() => vi.fn());
const append = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  getHeader: (event: TestEvent, name: string) => event.headers[name],
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("./private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) => readBody(...args),
}));
vi.mock("./private-vault-endpoint-auth.js", () => ({
  decodePrivateVaultEndpointProofHeader: (...args: unknown[]) =>
    decodeProof(...args),
  authenticatePrivateVaultAttendedEndpoint: (...args: unknown[]) =>
    authenticate(...args),
}));
vi.mock("./private-vault-migration-evidence-runtime.js", () => ({
  privateVaultMigrationEvidenceService: { append },
}));

import { handlePrivateVaultMigrationEvidence } from "./private-vault-migration-evidence-route.js";

interface TestEvent {
  headers: Record<string, string>;
  body: Uint8Array;
}

const vaultId = "11".repeat(16);
const migrationId = "22".repeat(16);
const exportId = "33".repeat(16);

function event(body: Uint8Array): TestEvent {
  return {
    body,
    headers: {
      "content-length": String(body.byteLength),
      "content-type": "application/octet-stream",
      "x-anc-endpoint-proof": "proof",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readBody.mockImplementation((input: TestEvent) =>
    Promise.resolve(input.body),
  );
  decodeProof.mockReturnValue({ proof: true });
  authenticate.mockResolvedValue({
    ownerEmail: "owner@example.test",
    orgId: "org-test",
    vaultId,
    endpointId: "44".repeat(16),
  });
  append.mockResolvedValue({
    kind: "export",
    migrationId,
    evidenceId: exportId,
  });
});

describe("attended Private Vault migration evidence route", () => {
  it("authenticates and stores an exact content-free evidence frame", async () => {
    const body = encodeAncV1MigrationEvidence({
      version: 1,
      suite: "anc/v1",
      type: "migration-evidence",
      kind: "export",
      vaultId,
      migrationId,
      exportId,
      exportBundleHash: "55".repeat(32),
      plaintextHash: "66".repeat(32),
      sourceSnapshotHash: "77".repeat(32),
      objectCount: 2,
    });
    const output = await handlePrivateVaultMigrationEvidence(
      event(body) as never,
    );
    expect(decodeAncV1MigrationEvidenceResponse(output as Uint8Array)).toEqual({
      version: 1,
      suite: "anc/v1",
      type: "migration-evidence-response",
      kind: "export",
      state: "stored",
      migrationId,
      evidenceId: exportId,
    });
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api/private-vault/migration/evidence",
      }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ vaultId }),
      expect.objectContaining({
        kind: "export",
        migrationId,
        exportId,
      }),
    );
    expect(body.every((byte) => byte === 0)).toBe(true);
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );
  });

  it("returns one opaque not-found response before parsing malformed framing", async () => {
    const malformed = event(Uint8Array.of(1));
    malformed.headers["content-type"] = "application/json";
    await expect(
      handlePrivateVaultMigrationEvidence(malformed as never),
    ).resolves.toEqual({ error: "Not found" });
    expect(readBody).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
  });
});
