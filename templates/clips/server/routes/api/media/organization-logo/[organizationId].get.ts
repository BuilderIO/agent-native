import { readPrivateBlob } from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { legacyOrganizationLogoObjectKey } from "../../../../../shared/organization-logo.js";
import { getDb, schema } from "../../../../db/index.js";
import {
  decodeOrganizationLogoReference,
  ORGANIZATION_LOGO_PURPOSE,
} from "../../../../lib/organization-logo.js";
import { fetchS3OrganizationLogoByLegacyUrl } from "../../../../lib/s3-upload-provider.js";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

function errorStatus(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (statusCode === 404) return 404;
    if (statusCode === 503) return 503;
  }
  return 502;
}

function legacyMimeType(url: string): string | null {
  const pathname = new URL(url).pathname;
  const extension = pathname
    .slice(pathname.lastIndexOf("/"))
    .match(/\.[^.]+$/)?.[0];
  return extension
    ? (MIME_BY_EXTENSION[extension.toLowerCase()] ?? null)
    : null;
}

function sendLogo(
  event: H3Event,
  data: Uint8Array,
  mimeType: string | null | undefined,
) {
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    setResponseStatus(event, 502);
    return { error: "Stored organization logo has an unsupported image type" };
  }
  if (data.byteLength > MAX_LOGO_BYTES) {
    setResponseStatus(event, 502);
    return { error: "Stored organization logo exceeds the size limit" };
  }
  setResponseHeader(event, "Content-Type", mimeType);
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Cache-Control", "public, max-age=300");
  return data;
}

export default defineEventHandler(async (event: H3Event) => {
  // Organization logos are public share/email branding, but this endpoint
  // resolves only the logo reference saved on this organization.
  const organizationId = getRouterParam(event, "organizationId");
  if (
    !organizationId ||
    organizationId.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(organizationId)
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid organizationId" };
  }

  const [settings] = await getDb()
    .select({ brandLogoUrl: schema.organizationSettings.brandLogoUrl })
    .from(schema.organizationSettings)
    .where(eq(schema.organizationSettings.organizationId, organizationId))
    .limit(1);
  const stored = settings?.brandLogoUrl?.trim();
  if (!stored) {
    setResponseStatus(event, 404);
    return { error: "Organization logo not found" };
  }

  try {
    const handle = decodeOrganizationLogoReference(stored, organizationId);
    if (handle) {
      if (handle.metadata?.purpose !== ORGANIZATION_LOGO_PURPOSE) {
        setResponseStatus(event, 404);
        return { error: "Organization logo not found" };
      }
      const result = await runWithRequestContext(
        { orgId: organizationId },
        () => readPrivateBlob(handle),
      );
      return sendLogo(event, result.data, result.mimeType ?? handle.mimeType);
    }

    if (legacyOrganizationLogoObjectKey(stored)) {
      const response = await runWithRequestContext(
        { orgId: organizationId },
        () => fetchS3OrganizationLogoByLegacyUrl(stored, organizationId),
      );
      if (!response) {
        setResponseStatus(event, 503);
        return { error: "S3 logo storage is not configured" };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        setResponseStatus(event, response.status === 404 ? 404 : 502);
        return { error: "Stored organization logo is unavailable" };
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_LOGO_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        setResponseStatus(event, 502);
        return { error: "Stored organization logo exceeds the size limit" };
      }
      return sendLogo(
        event,
        new Uint8Array(await response.arrayBuffer()),
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
          legacyMimeType(stored),
      );
    }

    setResponseStatus(event, 404);
    return { error: "Organization logo reference is unsupported" };
  } catch (error) {
    setResponseStatus(event, errorStatus(error));
    return { error: "Organization logo storage is unavailable" };
  }
});
