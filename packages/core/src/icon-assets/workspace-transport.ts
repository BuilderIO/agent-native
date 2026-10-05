import type { H3Event } from "h3";

import { canonicalA2AAudience, signA2AToken } from "../a2a/index.js";
import { resolveVercelDeploymentProtectionHeaders } from "../server/credential-provider.js";
import {
  CANONICAL_IDENTITY_SSO_HUB_URL,
  NETLIFY_PREVIEW_IDENTITY_SSO_HUB_URL,
  getIdentityHubUrl,
} from "../server/identity-sso-store.js";
import { resolveIdentityHubUrl } from "../server/identity-sso.js";

export interface WorkspaceIconAuthority {
  identityAuthority: string | null;
  identityId: string | null;
  allowedDomain: string | null;
}

function dispatchUrl(
  event: H3Event | undefined,
  authority: WorkspaceIconAuthority,
): string {
  if (!authority.identityId || !authority.identityAuthority) {
    throw new Error("Workspace icon identity authority is unavailable.");
  }
  const linked = new URL(authority.identityAuthority);
  const hubs = event
    ? [resolveIdentityHubUrl(event)]
    : [
        getIdentityHubUrl(),
        CANONICAL_IDENTITY_SSO_HUB_URL,
        NETLIFY_PREVIEW_IDENTITY_SSO_HUB_URL,
      ];
  const hub = hubs.find((candidate) => {
    if (!candidate) return false;
    const expected = new URL(candidate);
    return (
      linked.origin === expected.origin &&
      linked.pathname.replace(/\/+$/, "") ===
        expected.pathname.replace(/\/+$/, "")
    );
  });
  if (!hub) {
    throw new Error(
      "Workspace icon identity authority does not match this deployment.",
    );
  }
  return hub.replace(/\/+$/, "");
}

async function dispatchRequest(
  event: H3Event | undefined,
  authority: WorkspaceIconAuthority,
  email: string,
  scope:
    | "private-icon:upload"
    | "private-icon:verify-owner"
    | "private-icon:read"
    | "private-icon:list",
  assetId?: string,
  file?: { data: Uint8Array; mimeType: string; filename: string },
): Promise<Response> {
  const hub = dispatchUrl(event, authority);
  const token = await signA2AToken(
    email,
    authority.allowedDomain ?? undefined,
    undefined,
    {
      preferGlobalSecret: true,
      audience: canonicalA2AAudience(hub, "/private-icon"),
      expiresIn: "2m",
      extraClaims: {
        scope,
        org_id: authority.identityId,
        ...(assetId ? { asset_id: assetId } : {}),
      },
    },
  );
  const body = file ? new FormData() : undefined;
  if (file) {
    body!.set(
      "file",
      new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
      file.filename,
    );
  }
  const url = `${hub}/_agent-native/private-icons${assetId ? `/${encodeURIComponent(assetId)}` : ""}`;
  return fetch(url, {
    method: file
      ? "POST"
      : scope === "private-icon:verify-owner"
        ? "HEAD"
        : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...resolveVercelDeploymentProtectionHeaders(url),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function uploadFederatedWorkspaceIcon(
  event: H3Event,
  authority: WorkspaceIconAuthority,
  email: string,
  file: { data: Uint8Array; mimeType: string; filename: string },
): Promise<string> {
  const response = await dispatchRequest(
    event,
    authority,
    email,
    "private-icon:upload",
    undefined,
    file,
  );
  if (!response.ok)
    throw new Error(`Workspace icon upload failed (${response.status}).`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("id" in result) ||
    typeof result.id !== "string"
  ) {
    throw new Error("Workspace icon upload returned an invalid asset ID.");
  }
  return result.id;
}

export async function verifyFederatedWorkspaceIconOwner(
  event: H3Event,
  authority: WorkspaceIconAuthority,
  email: string,
  assetId: string,
): Promise<boolean> {
  const response = await dispatchRequest(
    event,
    authority,
    email,
    "private-icon:verify-owner",
    assetId,
  );
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(
      `Workspace icon ownership check failed (${response.status}).`,
    );
  return true;
}

export async function readFederatedWorkspaceIcon(
  event: H3Event,
  authority: WorkspaceIconAuthority,
  email: string,
  assetId: string,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const response = await dispatchRequest(
    event,
    authority,
    email,
    "private-icon:read",
    assetId,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Workspace icon read failed (${response.status}).`);
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (!mimeType?.startsWith("image/"))
    throw new Error("Workspace icon response is not an image.");
  return { data: new Uint8Array(await response.arrayBuffer()), mimeType };
}

export async function listFederatedWorkspaceIconsForOwner(
  authority: WorkspaceIconAuthority,
  email: string,
): Promise<Array<{ id: string; filename?: string }>> {
  const response = await dispatchRequest(
    undefined,
    authority,
    email,
    "private-icon:list",
  );
  if (!response.ok)
    throw new Error(`Workspace icon list failed (${response.status}).`);
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("assets" in body) ||
    !Array.isArray(body.assets)
  ) {
    throw new Error("Workspace icon list returned an invalid response.");
  }
  return body.assets.map((asset: unknown) => {
    if (
      !asset ||
      typeof asset !== "object" ||
      !("id" in asset) ||
      typeof asset.id !== "string"
    ) {
      throw new Error("Workspace icon list returned an invalid asset.");
    }
    return {
      id: asset.id,
      filename:
        "filename" in asset && typeof asset.filename === "string"
          ? asset.filename
          : undefined,
    };
  });
}
