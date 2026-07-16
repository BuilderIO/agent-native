import { createHash } from "node:crypto";

import {
  summarizeA2ATrustedPeers,
  trustedA2APeersFromEnv,
  type A2APeerTrustSummary,
} from "@agent-native/core/a2a";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import {
  extensionCapabilityManifestHash,
  normalizeExtensionAcceptedGrants,
  normalizeExtensionCapabilityManifest,
} from "@agent-native/core/extensions/capabilities";

export const PRIVACY_INVENTORY_SCHEMA_VERSION = 1;
export const PRIVACY_INVENTORY_AUTHORIZATION_CLASS: "deployment-security-admin" =
  "deployment-security-admin";

type CountMap = Record<string, number>;

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

function countValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeGroupedCounts(
  rows: Array<Record<string, unknown>>,
  allowed: readonly string[],
  key = "bucket",
): CountMap {
  const result = Object.fromEntries(allowed.map((name) => [name, 0]));
  result.other = 0;
  for (const row of rows) {
    const bucket = String(row[key] ?? "").toLowerCase();
    const count = countValue(row.count);
    if (allowed.includes(bucket)) result[bucket] += count;
    else result.other += count;
  }
  return result;
}

async function query(sql: string): Promise<QueryResult> {
  const result = await getDbExec().execute(sql);
  return { rows: result.rows as Array<Record<string, unknown>> };
}

async function tableExists(table: string): Promise<boolean> {
  const sql = isPostgres()
    ? `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`
    : `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '${table}'`;
  return countValue((await query(sql)).rows[0]?.count) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  if (isPostgres()) {
    return (
      countValue(
        (
          await query(
            `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
          )
        ).rows[0]?.count,
      ) > 0
    );
  }
  return (await query(`PRAGMA table_info(${table})`)).rows.some(
    (row) => String(row.name) === column,
  );
}

async function scalarCount(sql: string): Promise<number> {
  return countValue((await query(sql)).rows[0]?.count);
}

function summarizeExtensionPosture(rows: Array<Record<string, unknown>>): {
  versions: CountMap;
  egress: CountMap;
} {
  const byId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const current = byId.get(id) ?? [];
    current.push(row);
    byId.set(id, current);
  }
  const versions = { legacy: 0, v1: 0, invalid: 0, other: 0 };
  const egress = {
    none: 0,
    declared: 0,
    granted: 0,
    revoked: 0,
    invalid: 0,
    other: 0,
  };
  for (const extensionRows of byId.values()) {
    const first = extensionRows[0];
    let manifest: ReturnType<typeof normalizeExtensionCapabilityManifest>;
    try {
      manifest = normalizeExtensionCapabilityManifest(
        first?.capability_manifest,
      );
    } catch {
      versions.invalid += 1;
      egress.invalid += 1;
      continue;
    }
    if (!manifest) {
      versions.legacy += 1;
      egress.none += 1;
      continue;
    }
    versions.v1 += 1;
    if (!manifest.externalFetch?.length) {
      egress.none += 1;
      continue;
    }
    const manifestHash = extensionCapabilityManifestHash(manifest);
    let hasGranted = false;
    let hasRevoked = false;
    let invalidGrant = false;
    for (const row of extensionRows) {
      if (String(row.content_hash ?? "") !== manifestHash) continue;
      if (!row.grants_json) continue;
      try {
        const grant = normalizeExtensionAcceptedGrants(
          row.grants_json,
          manifest,
        );
        if (!grant.externalFetch?.length) continue;
        if (row.revoked_at) hasRevoked = true;
        else hasGranted = true;
      } catch {
        invalidGrant = true;
      }
    }
    if (hasGranted) egress.granted += 1;
    else if (invalidGrant) egress.invalid += 1;
    else if (hasRevoked) egress.revoked += 1;
    else egress.declared += 1;
  }
  return { versions, egress };
}

export function privacyInventoryAdminEmails(): Set<string> {
  return new Set(
    (process.env.AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function requirePrivacyInventoryOperator(input: {
  userEmail?: string;
  operatorAuthorized?: boolean;
}): string {
  const email = input.userEmail?.trim().toLowerCase();
  if (!email) throw new Error("Privacy inventory access denied");
  if (input.operatorAuthorized !== true) {
    throw new Error("Privacy inventory access denied");
  }
  if (!privacyInventoryAdminEmails().has(email)) {
    throw new Error("Privacy inventory access denied");
  }
  return email;
}

export interface ProductionPrivacyInventory {
  schemaVersion: 1;
  generatedAt: string;
  authorizationClass: typeof PRIVACY_INVENTORY_AUTHORIZATION_CLASS;
  counts: {
    documentsByVisibility: CountMap;
    databasesByVisibility: CountMap;
    directSharesByPrincipalType: CountMap;
    inheritedShareRelationships: number | null;
    legacyShareRowsBeforeProvenance: number | null;
    parentChildEquivalentShareRows: number;
    unclassifiedParentChildEquivalentShareRows: number;
    orphanedShareRows: number;
    localFileBackedDocuments: number;
    databaseSourcesByType: CountMap;
    notionLinksByHealth: CountMap;
    mediaByState: CountMap;
    mediaByStorageKind: CountMap;
    extensionsByCapabilityVersion: CountMap;
    extensionsByEgressState: CountMap;
    a2aPeerTrust: A2APeerTrustSummary;
    a2aQueuesByState: CountMap;
  };
  coverage: {
    extensions: boolean;
    inheritedShares: boolean;
    a2aQueue: boolean;
    a2aPeers: boolean;
  };
  evidence: { outputHash: string };
}

export async function buildProductionPrivacyInventory(): Promise<ProductionPrivacyInventory> {
  const generatedAt = new Date().toISOString();
  const documentsByVisibility = normalizeGroupedCounts(
    (
      await query(
        "SELECT visibility AS bucket, COUNT(*) AS count FROM documents GROUP BY visibility",
      )
    ).rows,
    ["private", "org", "public"],
  );
  const databasesByVisibility = normalizeGroupedCounts(
    (
      await query(
        "SELECT d.visibility AS bucket, COUNT(*) AS count FROM content_databases c JOIN documents d ON d.id = c.document_id WHERE c.deleted_at IS NULL GROUP BY d.visibility",
      )
    ).rows,
    ["private", "org", "public"],
  );
  const directSharesByPrincipalType = normalizeGroupedCounts(
    (
      await query(
        "SELECT principal_type AS bucket, COUNT(*) AS count FROM document_shares GROUP BY principal_type",
      )
    ).rows,
    ["user", "org"],
  );
  const parentChildEquivalentShareRows = await scalarCount(
    "SELECT COUNT(*) AS count FROM document_shares child_share JOIN documents child ON child.id = child_share.resource_id JOIN document_shares parent_share ON parent_share.resource_id = child.parent_id AND parent_share.principal_type = child_share.principal_type AND parent_share.principal_id = child_share.principal_id AND parent_share.role = child_share.role WHERE child.parent_id IS NOT NULL",
  );
  const inheritanceTableAvailable = await tableExists(
    "document_share_inheritances",
  );
  const provenanceStateAvailable = await tableExists(
    "document_share_provenance_state",
  );
  const legacyShareRowsBeforeProvenance = provenanceStateAvailable
    ? await scalarCount(
        "SELECT legacy_share_rows AS count FROM document_share_provenance_state WHERE id = 'v1'",
      )
    : null;
  const inheritedShareRelationships = inheritanceTableAvailable
    ? await scalarCount(
        "SELECT COUNT(*) AS count FROM document_share_inheritances inheritance JOIN document_shares child_share ON child_share.id = inheritance.child_share_id AND child_share.resource_id = inheritance.target_resource_id",
      )
    : null;
  const unclassifiedParentChildEquivalentShareRows = inheritanceTableAvailable
    ? await scalarCount(
        "SELECT COUNT(*) AS count FROM document_shares child_share JOIN documents child ON child.id = child_share.resource_id JOIN document_shares parent_share ON parent_share.resource_id = child.parent_id AND parent_share.principal_type = child_share.principal_type AND parent_share.principal_id = child_share.principal_id AND parent_share.role = child_share.role LEFT JOIN document_share_inheritances inheritance ON inheritance.child_share_id = child_share.id WHERE child.parent_id IS NOT NULL AND inheritance.child_share_id IS NULL",
      )
    : parentChildEquivalentShareRows;
  const orphanedShareRows = await scalarCount(
    "SELECT COUNT(*) AS count FROM document_shares share_row LEFT JOIN documents document ON document.id = share_row.resource_id WHERE document.id IS NULL",
  );
  const localFileBackedDocuments = await scalarCount(
    "SELECT COUNT(*) AS count FROM documents WHERE source_mode = 'local-files' OR source_kind IN ('file', 'local-file-copy')",
  );
  const databaseSourcesByType = normalizeGroupedCounts(
    (
      await query(
        "SELECT source_type AS bucket, COUNT(*) AS count FROM content_database_sources GROUP BY source_type",
      )
    ).rows,
    ["mock-local", "builder-cms", "local-table", "notion-database"],
  );
  const notionLinksByHealth = normalizeGroupedCounts(
    (
      await query(
        "SELECT CASE WHEN has_conflict = 1 THEN 'conflict' WHEN last_error IS NOT NULL AND last_error <> '' THEN 'error' WHEN state = 'linked' THEN 'healthy' ELSE 'other' END AS bucket, COUNT(*) AS count FROM document_sync_links WHERE provider = 'notion' GROUP BY CASE WHEN has_conflict = 1 THEN 'conflict' WHEN last_error IS NOT NULL AND last_error <> '' THEN 'error' WHEN state = 'linked' THEN 'healthy' ELSE 'other' END",
      )
    ).rows,
    ["healthy", "conflict", "error"],
  );
  const mediaByState = normalizeGroupedCounts(
    (
      await query(
        "SELECT state AS bucket, COUNT(*) AS count FROM document_media GROUP BY state",
      )
    ).rows,
    ["active", "revoked", "delete_pending", "deleted"],
  );
  const mediaByStorageKind = {
    privateBlob: Object.values(mediaByState).reduce(
      (sum, value) => sum + value,
      0,
    ),
    other: 0,
  };

  const extensionsAvailable = await tableExists("tools");
  const extensionCapabilityColumns =
    extensionsAvailable &&
    (await columnExists("tools", "capability_manifest_version")) &&
    (await columnExists("tools", "capability_manifest"));
  const consentGrantColumns =
    (await tableExists("tool_consents")) &&
    (await columnExists("tool_consents", "grants_json")) &&
    (await columnExists("tool_consents", "revoked_at"));
  const extensionRows =
    extensionCapabilityColumns && consentGrantColumns
      ? (
          await query(
            "SELECT t.id, t.capability_manifest_version, t.capability_manifest, c.content_hash, c.grants_json, c.revoked_at FROM tools t LEFT JOIN tool_consents c ON c.tool_id = t.id",
          )
        ).rows
      : [];
  const extensionPosture = summarizeExtensionPosture(extensionRows);
  const extensionsByCapabilityVersion = extensionPosture.versions;
  const extensionsByEgressState = extensionPosture.egress;

  const a2aQueueAvailable = await tableExists("a2a_tasks");
  const trustedPeers = trustedA2APeersFromEnv();
  const rawPeerRegistry = process.env.A2A_TRUSTED_PEERS?.trim(); // guard:allow-env-credential — deployment-owned peer registry; only aggregate validity is returned.
  let a2aRegistryValid = true;
  if (rawPeerRegistry) {
    try {
      const parsed = JSON.parse(rawPeerRegistry);
      a2aRegistryValid =
        Array.isArray(parsed) &&
        (parsed.length === 0 || trustedPeers.length > 0);
    } catch {
      a2aRegistryValid = false;
    }
  }
  const a2aPeerTrust = summarizeA2ATrustedPeers(
    a2aRegistryValid ? trustedPeers : [],
  );
  const a2aQueuesByState = a2aQueueAvailable
    ? normalizeGroupedCounts(
        (
          await query(
            "SELECT status_state AS bucket, COUNT(*) AS count FROM a2a_tasks GROUP BY status_state",
          )
        ).rows,
        [
          "submitted",
          "working",
          "completed",
          "failed",
          "canceled",
          "input-required",
        ],
      )
    : {
        submitted: 0,
        working: 0,
        completed: 0,
        failed: 0,
        canceled: 0,
        "input-required": 0,
        other: 0,
      };

  const unsigned = {
    schemaVersion: PRIVACY_INVENTORY_SCHEMA_VERSION as 1,
    generatedAt,
    authorizationClass: PRIVACY_INVENTORY_AUTHORIZATION_CLASS,
    counts: {
      documentsByVisibility,
      databasesByVisibility,
      directSharesByPrincipalType,
      inheritedShareRelationships,
      legacyShareRowsBeforeProvenance,
      parentChildEquivalentShareRows,
      unclassifiedParentChildEquivalentShareRows,
      orphanedShareRows,
      localFileBackedDocuments,
      databaseSourcesByType,
      notionLinksByHealth,
      mediaByState,
      mediaByStorageKind,
      extensionsByCapabilityVersion,
      extensionsByEgressState,
      a2aPeerTrust,
      a2aQueuesByState,
    },
    coverage: {
      extensions: extensionCapabilityColumns && consentGrantColumns,
      inheritedShares:
        inheritanceTableAvailable &&
        provenanceStateAvailable &&
        legacyShareRowsBeforeProvenance === 0 &&
        unclassifiedParentChildEquivalentShareRows === 0,
      a2aQueue: a2aQueueAvailable,
      a2aPeers: a2aRegistryValid,
    },
  };
  const outputHash = createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
  return { ...unsigned, evidence: { outputHash } };
}
