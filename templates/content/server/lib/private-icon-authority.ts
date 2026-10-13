import { canonicalA2AAudience, signA2AToken } from "@agent-native/core/a2a";
import { getDbExec } from "@agent-native/core/db";
import {
  getIconAsset,
  listIconAssets,
  putIconAsset,
  readIconAssetForAuthorizedReference,
} from "@agent-native/core/icon-assets";
import { resolveOrgDirectoryOrigin } from "@agent-native/core/mcp";
import { getOrgDomain } from "@agent-native/core/org";
import { resolveVercelDeploymentProtectionHeaders } from "@agent-native/core/server";

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function assertPrivateIconId(id: string): void {
  if (!ICON_ID.test(id)) throw new Error("Invalid private icon asset ID.");
}

async function authority(
  orgId: string | null,
): Promise<
  | { kind: "local" }
  | { kind: "dispatch"; url: string; orgDomain?: string; identityId?: string }
> {
  const dispatchUrl = resolveOrgDirectoryOrigin();
  if (!dispatchUrl || orgId === null) return { kind: "local" };
  if (!orgId)
    throw new Error("A workspace is required for federated private icons.");
  const orgDomain = (await getOrgDomain(orgId))?.trim() || undefined;
  const { rows } = await getDbExec().execute({
    sql: 'SELECT identity_authority AS "identityAuthority", identity_id AS "identityId" FROM organizations WHERE id = ? LIMIT 1',
    args: [orgId],
  });
  const row = rows[0] as
    | { identityAuthority?: string; identityId?: string }
    | undefined;
  const identityAuthority = row?.identityAuthority?.trim();
  const identityId = row?.identityId?.trim();
  const sameAuthority =
    identityAuthority &&
    new URL(identityAuthority).origin === new URL(dispatchUrl).origin;
  if (!orgDomain && (!sameAuthority || !identityId)) {
    throw new Error(
      "The workspace has no verified Dispatch organization identity.",
    );
  }
  return {
    kind: "dispatch",
    url: dispatchUrl.replace(/\/+$/u, ""),
    ...(orgDomain ? { orgDomain } : {}),
    ...(!orgDomain && identityId ? { identityId } : {}),
  };
}

async function dispatchToken(
  dispatch: Extract<
    Awaited<ReturnType<typeof authority>>,
    { kind: "dispatch" }
  >,
  userEmail: string,
  scope: string,
  assetId?: string,
): Promise<string> {
  return signA2AToken(userEmail, dispatch.orgDomain, undefined, {
    preferGlobalSecret: true,
    expiresIn: "1m",
    audience: canonicalA2AAudience(dispatch.url, "/private-icon"),
    extraClaims: {
      scope,
      ...(assetId ? { asset_id: assetId } : {}),
      ...(dispatch.identityId ? { org_id: dispatch.identityId } : {}),
    },
  });
}

function dispatchUrl(base: string, assetId?: string): string {
  return `${base}/_agent-native/private-icons${assetId ? `/${encodeURIComponent(assetId)}` : ""}`;
}

async function dispatchFetch(
  dispatch: Extract<
    Awaited<ReturnType<typeof authority>>,
    { kind: "dispatch" }
  >,
  userEmail: string,
  scope: string,
  method: "POST" | "HEAD" | "GET",
  assetId?: string,
  body?: FormData,
): Promise<Response> {
  const url = dispatchUrl(dispatch.url, assetId);
  const token = await dispatchToken(dispatch, userEmail, scope, assetId);
  const protectionHeaders = resolveVercelDeploymentProtectionHeaders(url);
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...protectionHeaders },
    ...(body ? { body } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function uploadPrivateIcon(input: {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<string> {
  if (!input.data.length || input.data.length > MAX_ICON_BYTES) {
    throw new Error("Private icons must be between 1 byte and 5 MB.");
  }
  const target = await authority(input.orgId);
  if (target.kind === "local") {
    const asset = await putIconAsset(input);
    return asset.id;
  }
  const body = new FormData();
  body.append(
    "file",
    new Blob([Uint8Array.from(input.data)], { type: input.mimeType }),
    input.filename || "icon",
  );
  const response = await dispatchFetch(
    target,
    input.ownerEmail,
    "private-icon:upload",
    "POST",
    undefined,
    body,
  );
  if (!response.ok)
    throw new Error(`Private icon upload failed (${response.status}).`);
  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== "string")
    throw new Error("Private icon authority returned an invalid asset ID.");
  assertPrivateIconId(result.id);
  return result.id;
}

export async function assertPrivateIconOwner(input: {
  assetId: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<void> {
  if (!(await ownsPrivateIcon(input)))
    throw new Error("Private icon is unavailable to this user.");
}

export async function ownsPrivateIcon(input: {
  assetId: string;
  ownerEmail: string;
  orgId: string | null;
}): Promise<boolean> {
  assertPrivateIconId(input.assetId);
  const target = await authority(input.orgId);
  if (target.kind === "local") {
    const asset = await getIconAsset(input.assetId, {
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    });
    return !!asset;
  }
  const response = await dispatchFetch(
    target,
    input.ownerEmail,
    "private-icon:verify-owner",
    "HEAD",
    input.assetId,
  );
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`Private icon authority unavailable (${response.status}).`);
}

export async function readPrivateIcon(input: {
  assetId: string;
  orgId: string | null;
}): Promise<{ data: Uint8Array; mimeType: string } | null> {
  assertPrivateIconId(input.assetId);
  const target = await authority(input.orgId);
  if (target.kind === "local") {
    return readIconAssetForAuthorizedReference(input.assetId, {
      orgId: input.orgId,
    });
  }
  const response = await dispatchFetch(
    target,
    "content-private-icon-reader",
    "private-icon:read",
    "GET",
    input.assetId,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Private icon authority unavailable (${response.status}).`);
  const mimeType = response.headers.get("content-type");
  if (!mimeType?.startsWith("image/"))
    throw new Error("Private icon authority returned an invalid content type.");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > MAX_ICON_BYTES)
    throw new Error("Private icon authority returned an oversized asset.");
  return { data, mimeType };
}

export async function listOwnedPrivateIcons(input: {
  ownerEmail: string;
  orgId: string | null;
}): Promise<Array<{ id: string; filename?: string; alt?: string }>> {
  const target = await authority(input.orgId);
  if (target.kind === "local") {
    const assets = await listIconAssets({ ...input, limit: 100 });
    return assets.map((asset) => ({
      id: asset.id,
      ...(asset.filename ? { filename: asset.filename } : {}),
      ...(asset.alt ? { alt: asset.alt } : {}),
    }));
  }
  const response = await dispatchFetch(
    target,
    input.ownerEmail,
    "private-icon:list",
    "GET",
  );
  if (!response.ok)
    throw new Error(`Private icon authority unavailable (${response.status}).`);
  const result = (await response.json()) as { assets?: unknown };
  if (!Array.isArray(result.assets))
    throw new Error("Private icon authority returned an invalid asset list.");
  return result.assets.map((asset: unknown) => {
    if (
      !asset ||
      typeof asset !== "object" ||
      typeof (asset as { id?: unknown }).id !== "string"
    ) {
      throw new Error("Private icon authority returned an invalid asset ID.");
    }
    const id = (asset as { id: string }).id;
    assertPrivateIconId(id);
    const filename = (asset as { filename?: unknown }).filename;
    return { id, ...(typeof filename === "string" ? { filename } : {}) };
  });
}
