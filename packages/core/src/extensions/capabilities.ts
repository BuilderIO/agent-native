import { createHash } from "node:crypto";

import { getDbExec, isPostgres } from "../db/client.js";
import { getRequestUserEmail } from "../server/request-context.js";
import { assertAccess, resolveAccess } from "../sharing/access.js";
import type { ShareRole } from "../sharing/schema.js";
import {
  extensionCapabilityAllows,
  normalizeExtensionAcceptedGrants,
  normalizeExtensionCapabilityManifest,
  type ExtensionAcceptedGrantsV1,
  type ExtensionCapabilityBinding,
  type ExtensionCapabilityManifestV1,
  type ExtensionCapabilityRequest,
  type ExtensionCapabilityRole,
} from "./capability-policy.js";
import { ensureExtensionsTables } from "./store.js";

interface RawCapabilityRow {
  capability_manifest_version?: number | string | null;
  capability_manifest?: string | null;
}

export interface ExtensionCapabilityDecision {
  allowed: boolean;
  role: ExtensionCapabilityRole;
  binding: ExtensionCapabilityBinding;
}

export function extensionCapabilityManifestHash(
  manifest: ExtensionCapabilityManifestV1,
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export async function getExtensionCapabilityBinding(
  extensionId: string,
  viewerEmail = getRequestUserEmail(),
): Promise<ExtensionCapabilityBinding> {
  await ensureExtensionsTables();
  if (!viewerEmail) return emptyBinding();
  const access = await resolveAccess("extension", extensionId);
  if (!access) return emptyBinding();

  const manifest = await readManifest(extensionId);
  if (!manifest) return emptyBinding();
  const manifestHash = extensionCapabilityManifestHash(manifest);
  const consent = await getDbExec().execute({
    sql: `SELECT grants_json
      FROM tool_consents
      WHERE viewer_email = ? AND tool_id = ? AND content_hash = ? AND revoked_at IS NULL
      ORDER BY granted_at DESC
      LIMIT 1`,
    args: [viewerEmail.toLowerCase(), extensionId, manifestHash],
  });
  const row = consent.rows?.[0] as { grants_json?: string | null } | undefined;
  if (!row?.grants_json) {
    return {
      manifestVersion: manifest.version,
      manifestHash,
      consented: false,
      grants: null,
    };
  }

  try {
    const grants = normalizeExtensionAcceptedGrants(row.grants_json, manifest);
    return {
      manifestVersion: manifest.version,
      manifestHash,
      consented: true,
      grants,
    };
  } catch {
    return {
      manifestVersion: manifest.version,
      manifestHash,
      consented: false,
      grants: null,
    };
  }
}

export async function authorizeExtensionCapability(
  extensionId: string,
  request: ExtensionCapabilityRequest,
): Promise<ExtensionCapabilityDecision | null> {
  await ensureExtensionsTables();
  const access = await resolveAccess("extension", extensionId);
  if (!access) return null;
  const role = access.role as ExtensionCapabilityRole;
  const binding = await getExtensionCapabilityBinding(extensionId);
  return {
    allowed: extensionCapabilityAllows(binding, role, request),
    role,
    binding,
  };
}

export async function acceptExtensionCapabilities(
  extensionId: string,
  manifestHash: string,
  requestedGrants: unknown,
): Promise<ExtensionCapabilityBinding> {
  await ensureExtensionsTables();
  await assertAccess("extension", extensionId, "viewer");
  const viewerEmail = getRequestUserEmail();
  if (!viewerEmail) throw new Error("Authentication required");
  const manifest = await readManifest(extensionId);
  if (!manifest)
    throw new Error(
      "This legacy extension has no capability manifest to accept",
    );
  const currentHash = extensionCapabilityManifestHash(manifest);
  if (manifestHash !== currentHash) {
    throw new Error(
      "Extension capabilities changed; review the current manifest before accepting",
    );
  }
  const grants = normalizeExtensionAcceptedGrants(requestedGrants, manifest);
  const now = new Date().toISOString();
  const client = getDbExec();
  if (isPostgres()) {
    await client.execute({
      sql: `INSERT INTO tool_consents (viewer_email, tool_id, content_hash, grants_json, granted_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT (viewer_email, tool_id, content_hash)
        DO UPDATE SET grants_json = EXCLUDED.grants_json, granted_at = EXCLUDED.granted_at, revoked_at = NULL`,
      args: [
        viewerEmail.toLowerCase(),
        extensionId,
        currentHash,
        JSON.stringify(grants),
        now,
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO tool_consents (viewer_email, tool_id, content_hash, grants_json, granted_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT (viewer_email, tool_id, content_hash)
        DO UPDATE SET grants_json = excluded.grants_json, granted_at = excluded.granted_at, revoked_at = NULL`,
      args: [
        viewerEmail.toLowerCase(),
        extensionId,
        currentHash,
        JSON.stringify(grants),
        now,
      ],
    });
  }
  return {
    manifestVersion: manifest.version,
    manifestHash: currentHash,
    consented: true,
    grants,
  };
}

export async function revokeExtensionCapabilities(
  extensionId: string,
): Promise<void> {
  await ensureExtensionsTables();
  await assertAccess("extension", extensionId, "viewer");
  const viewerEmail = getRequestUserEmail();
  if (!viewerEmail) throw new Error("Authentication required");
  await getDbExec().execute({
    sql: `UPDATE tool_consents SET revoked_at = ?
      WHERE viewer_email = ? AND tool_id = ? AND revoked_at IS NULL`,
    args: [new Date().toISOString(), viewerEmail.toLowerCase(), extensionId],
  });
}

export async function getExtensionCapabilityStatus(
  extensionId: string,
): Promise<{
  role: "owner" | ShareRole;
  manifest: ExtensionCapabilityManifestV1 | null;
  binding: ExtensionCapabilityBinding;
}> {
  await ensureExtensionsTables();
  const access = await resolveAccess("extension", extensionId);
  if (!access) throw new Error("Extension not found");
  return {
    role: access.role,
    manifest: await readManifest(extensionId),
    binding: await getExtensionCapabilityBinding(extensionId),
  };
}

async function readManifest(
  extensionId: string,
): Promise<ExtensionCapabilityManifestV1 | null> {
  const result = await getDbExec().execute({
    sql: `SELECT capability_manifest_version, capability_manifest FROM tools WHERE id = ? LIMIT 1`,
    args: [extensionId],
  });
  const row = result.rows?.[0] as RawCapabilityRow | undefined;
  if (!row?.capability_manifest) return null;
  try {
    return normalizeExtensionCapabilityManifest(row.capability_manifest);
  } catch {
    return null;
  }
}

function emptyBinding(): ExtensionCapabilityBinding {
  return {
    manifestVersion: null,
    manifestHash: null,
    consented: false,
    grants: null,
  };
}

export type { ExtensionAcceptedGrantsV1 };
