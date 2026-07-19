import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentMigrationTransport,
  PrivateVaultMigrationTransportError,
} from "./content-migration-transport.js";

const origin = "https://content.example.test";
const vaultId = "21".repeat(16);
const migrationId = "31".repeat(16);

function ledger(state = "preflight") {
  return {
    migrationId,
    vaultId,
    state,
    sourceSnapshotHash: "41".repeat(32),
    sourceCount: 1,
    verifiedCount: 0,
    cutoverManifestObjectId: "42".repeat(16),
    cutoverManifestRevisionId: null,
    cutoverManifestCiphertextHash: null,
    exportBundleHash: null,
    exportVerifiedAt: null,
    recoveryDrillVerifiedAt: null,
    backupRetentionAcknowledgedAt: null,
    cutoverAt: null,
    cleanupAt: null,
    rolledBackAt: null,
  };
}

function response(
  value: unknown,
  init: { url?: string; status?: number } = {},
) {
  const bytes = Buffer.from(JSON.stringify(value));
  const result = new Response(bytes, {
    status: init.status ?? 200,
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": "application/json; charset=utf-8",
    },
  });
  Object.defineProperties(result, {
    url: {
      value:
        init.url ??
        `${origin}/_agent-native/actions/manage-private-vault-migration`,
    },
    redirected: { value: false },
  });
  return result;
}

describe("Private Vault migration hosted action transport", () => {
  it("discovers an active durable migration without a caller-held ID", async () => {
    const current = { ledger: ledger(), items: [] };
    const session = {
      fetch: vi.fn(async () => response({ operation: "active", current })),
    };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });
    await expect(transport.active(vaultId)).resolves.toMatchObject({
      ledger: { migrationId },
    });
  });

  it("lists a count-bound exact candidate set", async () => {
    const session = {
      fetch: vi.fn(async () =>
        response({
          operation: "candidates",
          sourceCount: 2,
          sourceDocumentIds: ["root", "child"],
        }),
      ),
    };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });
    await expect(transport.candidates(vaultId)).resolves.toEqual([
      "root",
      "child",
    ]);
  });

  it("uses the authenticated action surface and accepts only the exact ledger", async () => {
    let requestBody: Uint8Array | undefined;
    const session = {
      fetch: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = Uint8Array.from(init.body as Uint8Array);
        return response({ operation: "preflight", ledger: ledger() });
      }),
    };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });

    await expect(
      transport.preflight(vaultId, ["legacy-document"]),
    ).resolves.toMatchObject({ migrationId, state: "preflight" });
    expect(session.fetch).toHaveBeenCalledWith(
      `${origin}/_agent-native/actions/manage-private-vault-migration`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: expect.objectContaining({
          "X-Agent-Native-CSRF": "1",
          "X-Agent-Native-Frontend": "1",
        }),
      }),
    );
    expect(JSON.parse(Buffer.from(requestBody!).toString("utf8"))).toEqual({
      vaultId,
      operation: "preflight",
      sourceDocumentIds: ["legacy-document"],
    });
  });

  it("parses a bounded status snapshot without admitting unknown hosted fields", async () => {
    const exact = {
      operation: "status",
      ledger: ledger("copying"),
      items: [
        {
          migrationId,
          sourceDocumentId: "legacy-document",
          parentSourceDocumentId: null,
          objectId: "51".repeat(16),
          sourceDigest: "61".repeat(32),
          state: "pending",
          sealedRevisionId: null,
          sealedCiphertextHash: null,
          verifiedAt: null,
          cleanupAt: null,
        },
      ],
    };
    const session = { fetch: vi.fn(async () => response(exact)) };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });
    await expect(transport.status(vaultId, migrationId)).resolves.toMatchObject(
      {
        ledger: { state: "copying" },
        items: [{ sourceDocumentId: "legacy-document" }],
      },
    );

    session.fetch.mockResolvedValueOnce(
      response({ ...exact, plaintextPreview: "must not exist" }),
    );
    await expect(transport.status(vaultId, migrationId)).rejects.toBeInstanceOf(
      PrivateVaultMigrationTransportError,
    );
  });

  it("requests cleanup only through the authenticated action surface", async () => {
    let requestBody: Uint8Array | undefined;
    const session = {
      fetch: vi.fn(async (_url: string, init: RequestInit) => {
        requestBody = Uint8Array.from(init.body as Uint8Array);
        return response({ operation: "cleanup", ledger: ledger("cleaned") });
      }),
    };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });
    await expect(
      transport.cleanup(vaultId, migrationId),
    ).resolves.toMatchObject({ state: "cleaned" });
    expect(JSON.parse(Buffer.from(requestBody!).toString("utf8"))).toEqual({
      vaultId,
      operation: "cleanup",
      migrationId,
    });
  });

  it("rejects redirects, alternate origins, malformed lengths, and insecure origins", async () => {
    expect(
      () =>
        new PrivateVaultContentMigrationTransport({
          session: { fetch: vi.fn() },
          origin: "http://content.example.test",
        }),
    ).toThrow(PrivateVaultMigrationTransportError);
    const session = {
      fetch: vi.fn(async () =>
        response(
          { operation: "begin", ledger: ledger("copying") },
          { url: "https://attacker.example/action" },
        ),
      ),
    };
    const transport = new PrivateVaultContentMigrationTransport({
      session,
      origin,
    });
    await expect(transport.begin(vaultId, migrationId)).rejects.toBeInstanceOf(
      PrivateVaultMigrationTransportError,
    );
  });
});
