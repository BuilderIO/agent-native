
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

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function hasExpectedImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/gif") {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  return false;
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
      const ext = EXT_BY_MIME[mimeType];
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
