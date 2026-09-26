/**
 * Generic media upload — used for brand logos and any other ad-hoc image
 * uploads the app needs. The video upload path lives under /api/uploads/
 * because it's chunked; this route is a one-shot file POST.
 *
 * POST /api/media?organizationId=<id>&filename=<name>
 *   Body: raw file bytes (Content-Type header determines the MIME type)
 *   Response: { reference, filename, mimeType, size }
 *
 * Max size: 5 MB (logos). Storage uses private blob storage; SQL stores only
 * the returned opaque reference, never the image bytes.
 */

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  getQuery,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  hasExpectedImageSignature,
  IMAGE_EXTENSION_BY_MIME,
  isSupportedImageMimeType,
} from "../../../lib/image-signature.js";
import {
  encodeOrganizationLogoReference,
  ORGANIZATION_LOGO_PURPOSE,
} from "../../../lib/organization-logo.js";
import { requireOrganizationAccess } from "../../../lib/recordings.js";

const MAX_BYTES = 5 * 1024 * 1024;

const STORAGE_SETUP_REQUIRED_REASON =
  "File storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage in Settings → File uploads, then retry.";

function randId(): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const query = getQuery(event);
      const organizationId =
        typeof query.organizationId === "string" ? query.organizationId : "";
      if (!organizationId) {
        setResponseStatus(event, 400);
        return { error: "organizationId is required" };
      }
      await requireOrganizationAccess(organizationId, ["admin"]);

      const raw = await readRawBody(event, false);
      if (!raw || !(raw as Buffer | Uint8Array).length) {
        setResponseStatus(event, 400);
        return { error: "Empty upload" };
      }
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : new Uint8Array(
              (raw as Buffer).buffer,
              (raw as Buffer).byteOffset,
              (raw as Buffer).byteLength,
            );
      if (bytes.byteLength > MAX_BYTES) {
        setResponseStatus(event, 413);
        return { error: "File too large (max 5 MB)" };
      }

      const mimeType = (
        getHeader(event, "content-type") || "application/octet-stream"
      )
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = isSupportedImageMimeType(mimeType)
        ? IMAGE_EXTENSION_BY_MIME[mimeType]
        : undefined;
      if (!ext) {
        setResponseStatus(event, 400);
        return { error: "Only PNG, JPEG, GIF, and WebP images are allowed" };
      }
      if (!hasExpectedImageSignature(bytes, mimeType)) {
        setResponseStatus(event, 400);
        return { error: "Uploaded image bytes do not match Content-Type" };
      }

      const originalName =
        typeof query.filename === "string" ? query.filename : "upload";

      const filename = `logo-${randId()}${ext}`;
      const handle = await runWithRequestContext(
        { userEmail: session.email, orgId: organizationId },
        () =>
          putPrivateBlob({
            data: bytes,
            mimeType,
            filename,
            ownerEmail: session.email,
            metadata: {
              purpose: ORGANIZATION_LOGO_PURPOSE,
              organizationId,
            },
          }),
      );

      if (!handle) {
        setResponseStatus(event, 409);
        return { error: STORAGE_SETUP_REQUIRED_REASON };
      }

      return {
        reference: encodeOrganizationLogoReference(handle),
        filename,
        originalName,
        mimeType,
        size: bytes.byteLength,
      };
    },
  );
});
