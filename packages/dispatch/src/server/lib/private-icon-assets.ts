import { verifyA2AToken } from "@agent-native/core/a2a";
import {
  getIconAsset,
  IconUploadBodyError,
  readIconUploadFormData,
  readIconAssetForAuthorizedReference,
  listIconAssets,
  putIconAsset,
} from "@agent-native/core/icon-assets";
import { isOrgMember, resolveOrgByDomain } from "@agent-native/core/org";
import { getSession, runWithRequestContext } from "@agent-native/core/server";

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_ID = /^[A-Za-z0-9_-]{8,128}$/;
const ICON_PATH = /^\/([A-Za-z0-9_-]{8,128})\/?$/;

type IconScope =
  | "private-icon:upload"
  | "private-icon:list"
  | "private-icon:verify-owner"
  | "private-icon:read";

type PeerIdentity = {
  email: string;
  orgId: string;
  assetId?: string;
};

interface PrivateIconEvent {
  url: URL;
  req: Request;
}

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { error: message },
    { status, headers: PRIVATE_HEADERS },
  );
}

async function peerIdentity(
  event: PrivateIconEvent,
  scope: IconScope,
): Promise<PeerIdentity | null> {
  const authorization = event.req.headers.get("authorization");
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match) return null;
  const verified = await verifyA2AToken(match[1]!, event as never, {
    routePrefix: "private-icon",
    globalSecretOnly: true,
    includeClaims: true,
  });
  const claims = verified.claims;
  if (
    !verified.email?.trim() ||
    !claims ||
    claims.scope !== scope ||
    !claims.aud ||
    !claims.iss
  ) {
    return null;
  }

  const claimedOrgId =
    typeof claims.org_id === "string" ? claims.org_id.trim() : "";
  const domain = verified.orgDomain?.trim().toLowerCase();
  const mapped = domain ? await resolveOrgByDomain(domain) : null;
  if (domain && !mapped) return null;
  if (mapped && claimedOrgId && mapped.orgId !== claimedOrgId) return null;
  const orgId = mapped?.orgId ?? claimedOrgId;
  if (!orgId) return null;

  // `asset_id` is a capability fence on service reads. Content checks an
  // accessible resource reference before signing this exact ID.
  const assetId =
    typeof claims.asset_id === "string" ? claims.asset_id.trim() : undefined;
  if (scope === "private-icon:read" && (!assetId || !ICON_ID.test(assetId))) {
    return null;
  }
  return { email: verified.email.trim().toLowerCase(), orgId, assetId };
}

async function ownerIdentity(
  event: PrivateIconEvent,
  scope: IconScope,
): Promise<{ email: string; orgId?: string } | null> {
  if (event.req.headers.has("authorization")) {
    const peer = await peerIdentity(event, scope);
    if (!peer || !(await isOrgMember(peer.orgId, peer.email))) return null;
    return { email: peer.email, orgId: peer.orgId };
  }
  if (scope === "private-icon:verify-owner") return null;
  const session = await getSession(event as never);
  if (!session?.email) return null;
  if (session.orgId && !(await isOrgMember(session.orgId, session.email))) {
    return null;
  }
  return { email: session.email.trim().toLowerCase(), orgId: session.orgId };
}

export function createPrivateIconAssetsHandler() {
  return async (event: PrivateIconEvent): Promise<Response> => {
    const method = event.req.method.toUpperCase();
    const path =
      new URL(event.req.url).pathname.replace(
        /^\/_agent-native\/private-icons(?=\/|$)/,
        "",
      ) || "/";
    const idMatch = ICON_PATH.exec(path);
    if (path !== "/" && !idMatch) {
      return errorResponse(404, "Icon not found");
    }

    if (path === "/" && method === "POST") {
      const owner = await ownerIdentity(event, "private-icon:upload");
      if (!owner) return errorResponse(401, "Unauthorized");
      const length = Number(event.req.headers.get("content-length"));
      if (!Number.isSafeInteger(length) || length <= 0) {
        return errorResponse(411, "Content length required");
      }
      if (
        !event.req.headers
          .get("content-type")
          ?.startsWith("multipart/form-data;")
      ) {
        return errorResponse(415, "Multipart icon upload required");
      }
      let files: FormDataEntryValue[];
      try {
        files = (await readIconUploadFormData(event.req)).getAll("file");
      } catch (error) {
        if (error instanceof IconUploadBodyError)
          return errorResponse(error.statusCode, error.message);
        throw error;
      }
      const file = files.length === 1 ? files[0] : undefined;
      if (!file || typeof file === "string") {
        return errorResponse(400, "A valid icon file is required");
      }
      const data = new Uint8Array(await file.arrayBuffer());
      if (data.byteLength === 0 || data.byteLength > MAX_ICON_BYTES) {
        return errorResponse(413, "Icon too large");
      }
      if (
        !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
          file.type,
        )
      ) {
        return errorResponse(415, "Unsupported icon type");
      }
      const asset = await runWithRequestContext(
        { userEmail: owner.email, orgId: owner.orgId },
        () =>
          putIconAsset({
            data,
            mimeType: file.type ?? "",
            filename: file.name,
            ownerEmail: owner.email,
            orgId: owner.orgId,
          }),
      );
      return Response.json(
        {
          id: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          contentType: asset.mimeType,
          byteLength: asset.size,
        },
        { status: 201, headers: PRIVATE_HEADERS },
      );
    }

    if (path === "/" && method === "GET") {
      const owner = await ownerIdentity(event, "private-icon:list");
      if (!owner) return errorResponse(401, "Unauthorized");
      const assets = await runWithRequestContext(
        { userEmail: owner.email, orgId: owner.orgId },
        () =>
          listIconAssets({
            ownerEmail: owner.email,
            orgId: owner.orgId,
            limit: 100,
          }),
      );
      return Response.json(
        {
          assets: assets.map(({ id, filename, mimeType, size, createdAt }) => ({
            id,
            filename,
            mimeType,
            size,
            createdAt,
          })),
        },
        { headers: PRIVATE_HEADERS },
      );
    }

    const id = idMatch?.[1];
    if (id && method === "HEAD") {
      const owner = await ownerIdentity(event, "private-icon:verify-owner");
      if (!owner) return errorResponse(401, "Unauthorized");
      const asset = await runWithRequestContext(
        { userEmail: owner.email, orgId: owner.orgId },
        () => getIconAsset(id, { ownerEmail: owner.email, orgId: owner.orgId }),
      );
      if (!asset) return errorResponse(404, "Icon not found");
      return new Response(null, { status: 200, headers: PRIVATE_HEADERS });
    }

    if (id && method === "GET") {
      const peer = await peerIdentity(event, "private-icon:read");
      if (!peer) return errorResponse(401, "Unauthorized");
      if (peer.assetId !== id) {
        return errorResponse(403, "Icon access denied");
      }
      const icon = await runWithRequestContext(
        { userEmail: peer.email, orgId: peer.orgId },
        () => readIconAssetForAuthorizedReference(id, { orgId: peer.orgId }),
      );
      if (!icon) return errorResponse(404, "Icon not found");
      const headers = new Headers(PRIVATE_HEADERS);
      headers.set("content-type", icon.mimeType);
      headers.set("content-length", String(icon.data.byteLength));
      if (icon.mimeType === "image/svg+xml") {
        headers.set(
          "content-security-policy",
          "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        );
      }
      return new Response(Buffer.from(icon.data), { headers });
    }

    return errorResponse(405, "Method not allowed");
  };
}
