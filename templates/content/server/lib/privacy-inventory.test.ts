import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), postgres: false }));

vi.mock("@agent-native/core/a2a", () => ({
  trustedA2APeersFromEnv: () => [],
  summarizeA2ATrustedPeers: () => ({
    peers: { active: 0, revoked: 0 },
    credentials: { active: 0, revoked: 0, notYetActive: 0, expired: 0 },
    peersInRotationOverlap: 0,
  }),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
  isPostgres: () => mocks.postgres,
}));

import {
  buildProductionPrivacyInventory,
  requirePrivacyInventoryOperator,
} from "./privacy-inventory";

function result(rows: Array<Record<string, unknown>>) {
  return { rows };
}

describe("privacy inventory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv(
      "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_EMAILS",
      "security@example.com",
    );
    mocks.execute.mockReset();
    mocks.postgres = false;
    const manifest = {
      version: 1,
      externalFetch: [{ origin: "https://api.example.com", methods: ["GET"] }],
    };
    const manifestHash = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex");
    mocks.execute.mockImplementation(async (statement: string) => {
      if (statement.startsWith("PRAGMA table_info(tools)")) {
        return result([
          { name: "capability_manifest_version" },
          { name: "capability_manifest" },
        ]);
      }
      if (statement.startsWith("PRAGMA table_info(tool_consents)")) {
        return result([{ name: "grants_json" }, { name: "revoked_at" }]);
      }
      if (statement.includes("information_schema.tables")) {
        return result([{ count: 1 }]);
      }
      if (statement.includes("information_schema.columns")) {
        return result([{ count: 1 }]);
      }
      if (statement.includes("sqlite_master")) return result([{ count: 1 }]);
      if (statement.includes("FROM documents GROUP BY visibility")) {
        return result([
          { bucket: "private", count: 3 },
          { bucket: "public", count: 1 },
          { bucket: "unexpected-private-label", count: 2 },
        ]);
      }
      if (statement.includes("FROM content_databases c")) {
        return result([{ bucket: "org", count: 2 }]);
      }
      if (statement.includes("FROM document_shares GROUP BY")) {
        return result([{ bucket: "user", count: 4 }]);
      }
      if (statement.includes("LEFT JOIN document_share_inheritances")) {
        return result([{ count: 0 }]);
      }
      if (statement.includes("FROM document_share_inheritances inheritance")) {
        return result([{ count: 2 }]);
      }
      if (statement.includes("FROM document_share_provenance_state")) {
        return result([{ count: 0 }]);
      }
      if (statement.includes("child_share")) return result([{ count: 2 }]);
      if (statement.includes("LEFT JOIN documents"))
        return result([{ count: 1 }]);
      if (statement.includes("source_mode = 'local-files'")) {
        return result([{ count: 5 }]);
      }
      if (statement.includes("FROM content_database_sources")) {
        return result([{ bucket: "notion-database", count: 2 }]);
      }
      if (statement.includes("FROM document_sync_links")) {
        return result([
          { bucket: "healthy", count: 2 },
          { bucket: "error", count: 1 },
        ]);
      }
      if (statement.includes("FROM document_media")) {
        return result([{ bucket: "active", count: 7 }]);
      }
      if (statement.includes("FROM tools t LEFT JOIN tool_consents")) {
        return result([
          { id: "legacy", capability_manifest: null },
          {
            id: "granted",
            capability_manifest: JSON.stringify(manifest),
            content_hash: manifestHash,
            grants_json: JSON.stringify(manifest),
            revoked_at: null,
          },
          {
            id: "declared",
            capability_manifest: JSON.stringify(manifest),
            content_hash: null,
            grants_json: null,
            revoked_at: null,
          },
        ]);
      }
      if (statement.includes("FROM a2a_tasks")) {
        return result([{ bucket: "working", count: 1 }]);
      }
      throw new Error(`Unexpected aggregate query: ${statement}`);
    });
  });

  it("returns only fixed aggregate buckets and a reproducible evidence hash", async () => {
    const inventory = await buildProductionPrivacyInventory();

    expect(inventory).toMatchObject({
      schemaVersion: 1,
      authorizationClass: "deployment-security-admin",
      counts: {
        documentsByVisibility: { private: 3, org: 0, public: 1, other: 2 },
        inheritedShareRelationships: 2,
        legacyShareRowsBeforeProvenance: 0,
        parentChildEquivalentShareRows: 2,
        unclassifiedParentChildEquivalentShareRows: 0,
        orphanedShareRows: 1,
        localFileBackedDocuments: 5,
        mediaByStorageKind: { privateBlob: 7, other: 0 },
        extensionsByCapabilityVersion: {
          legacy: 1,
          v1: 2,
          invalid: 0,
          other: 0,
        },
        extensionsByEgressState: {
          none: 1,
          declared: 1,
          granted: 1,
          revoked: 0,
          invalid: 0,
          other: 0,
        },
        a2aQueuesByState: { working: 1 },
      },
      coverage: {
        extensions: true,
        inheritedShares: true,
        a2aQueue: true,
        a2aPeers: true,
      },
    });
    expect(inventory.evidence.outputHash).toMatch(/^[a-f0-9]{64}$/);
    const { evidence: _evidence, ...unsigned } = inventory;
    expect(inventory.evidence.outputHash).toBe(
      createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
    );
    expect(JSON.stringify(inventory)).not.toContain("unexpected-private-label");
    expect(JSON.stringify(inventory)).not.toContain("security@example.com");
  });

  it("uses portable PostgreSQL metadata probes without changing the aggregate contract", async () => {
    mocks.postgres = true;
    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.coverage.extensions).toBe(true);
    expect(
      mocks.execute.mock.calls.some(([sql]) =>
        String(sql).includes("information_schema.tables"),
      ),
    ).toBe(true);
    expect(
      mocks.execute.mock.calls.some(([sql]) =>
        String(sql).includes("information_schema.columns"),
      ),
    ).toBe(true);
  });

  it("marks a malformed non-empty A2A peer registry as uncovered", async () => {
    vi.stubEnv("A2A_TRUSTED_PEERS", "{not-json");

    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.coverage.a2aPeers).toBe(false);
    expect(inventory.counts.a2aPeerTrust).toEqual({
      peers: { active: 0, revoked: 0 },
      credentials: { active: 0, revoked: 0, notYetActive: 0, expired: 0 },
      peersInRotationOverlap: 0,
    });
  });

  it("classifies one extension once and fails malformed current grants closed", async () => {
    const baseExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM tools t LEFT JOIN tool_consents")) {
        const manifest = {
          version: 1,
          externalFetch: [
            { origin: "https://api.example.com", methods: ["GET"] },
          ],
        };
        const manifestHash = createHash("sha256")
          .update(JSON.stringify(manifest))
          .digest("hex");
        return result([
          {
            id: "invalid-grant",
            capability_manifest: JSON.stringify(manifest),
            content_hash: manifestHash,
            grants_json: "{not-json",
            revoked_at: null,
          },
          {
            id: "invalid-grant",
            capability_manifest: JSON.stringify(manifest),
            content_hash: "stale-manifest-hash",
            grants_json: JSON.stringify(manifest),
            revoked_at: null,
          },
        ]);
      }
      return baseExecute!(statement);
    });

    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.counts.extensionsByCapabilityVersion).toEqual({
      legacy: 0,
      v1: 1,
      invalid: 0,
      other: 0,
    });
    expect(inventory.counts.extensionsByEgressState).toEqual({
      none: 0,
      declared: 0,
      granted: 0,
      revoked: 0,
      invalid: 1,
      other: 0,
    });
  });

  it("reports absent extension and A2A queue schema as incomplete coverage", async () => {
    const baseExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (statement: string) => {
      if (
        statement.includes("sqlite_master") &&
        (statement.includes("'tools'") ||
          statement.includes("'tool_consents'") ||
          statement.includes("'a2a_tasks'"))
      ) {
        return result([{ count: 0 }]);
      }
      return baseExecute!(statement);
    });

    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.coverage).toMatchObject({
      extensions: false,
      a2aQueue: false,
    });
    expect(inventory.counts.extensionsByCapabilityVersion).toEqual({
      legacy: 0,
      v1: 0,
      invalid: 0,
      other: 0,
    });
    expect(inventory.counts.a2aQueuesByState).toEqual({
      submitted: 0,
      working: 0,
      completed: 0,
      failed: 0,
      canceled: 0,
      "input-required": 0,
      other: 0,
    });
  });

  it("does not guess inherited shares when the provenance table is absent", async () => {
    const baseExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (statement: string) => {
      if (
        statement.includes("sqlite_master") &&
        (statement.includes("'document_share_inheritances'") ||
          statement.includes("'document_share_provenance_state'"))
      ) {
        return result([{ count: 0 }]);
      }
      return baseExecute!(statement);
    });

    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.counts.inheritedShareRelationships).toBeNull();
    expect(inventory.counts.legacyShareRowsBeforeProvenance).toBeNull();
    expect(inventory.counts.unclassifiedParentChildEquivalentShareRows).toBe(2);
    expect(inventory.coverage.inheritedShares).toBe(false);
  });

  it("keeps inherited-share coverage false when migration observed legacy grants", async () => {
    const baseExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (statement: string) => {
      if (statement.includes("FROM document_share_provenance_state")) {
        return result([{ count: 4 }]);
      }
      return baseExecute!(statement);
    });

    const inventory = await buildProductionPrivacyInventory();

    expect(inventory.counts.legacyShareRowsBeforeProvenance).toBe(4);
    expect(inventory.coverage.inheritedShares).toBe(false);
  });

  it("requires the deployment allowlist and refuses agent invocation surfaces", () => {
    expect(
      requirePrivacyInventoryOperator({
        userEmail: "SECURITY@example.com",
        operatorAuthorized: true,
      }),
    ).toBe("security@example.com");
    expect(() =>
      requirePrivacyInventoryOperator({
        userEmail: "security@example.com",
        operatorAuthorized: false,
      }),
    ).toThrow("Privacy inventory access denied");
    expect(() =>
      requirePrivacyInventoryOperator({
        userEmail: "member@example.com",
        operatorAuthorized: true,
      }),
    ).toThrow("Privacy inventory access denied");
  });
});
