import fs from "fs";
import path from "path";

import {
  attachmentFailureToError,
  deleteAttachment,
  mintAttachmentRef,
  resolveAttachment,
  type AttachmentResolution,
  type MintAttachmentResult,
} from "@agent-native/core/private-blob";
import { getRequestOrgId } from "@agent-native/core/server/request-context";

import { isHostedSlidesRuntime, tenantUploadDir } from "./tenant-files.js";

export { isHostedSlidesRuntime } from "./tenant-files.js";

/**
 * Hosted uploads are core attachment refs: minted and opened only through
 * `@agent-native/core/private-blob`. Slides keeps no descriptor of its own.
 */
export function mintUploadedReference(args: {
  email: string;
  orgId?: string | null;
  filename: string;
  data: Uint8Array;
  mimeType: string;
}): Promise<MintAttachmentResult> {
  return mintAttachmentRef({
    data: args.data,
    filename: args.filename,
    mimeType: args.mimeType,
    ownerEmail: args.email,
    orgId: args.orgId,
    metadata: { kind: "slides-reference-upload" },
  });
}

export function resolveUploadedReference(
  reference: string,
  email: string,
): Promise<AttachmentResolution> {
  return resolveAttachment(reference, {
    ownerEmail: email,
    orgId: getRequestOrgId() ?? null,
  });
}

export async function deleteUploadedReference(
  reference: string,
  email: string,
): Promise<boolean> {
  if (isHostedSlidesRuntime()) {
    const result = await deleteAttachment(reference, {
      ownerEmail: email,
      orgId: getRequestOrgId() ?? null,
    });
    if (result.status !== "ok") throw attachmentFailureToError(result);
    return result.deleted;
  }

  const uploadDir = path.resolve(tenantUploadDir(email));
  const candidate = path.resolve(process.cwd(), reference);
  if (path.dirname(candidate) !== uploadDir) {
    throw attachmentFailureToError({
      status: "forbiddenScope",
      reason: "path_outside_uploads",
    });
  }
  try {
    await fs.promises.unlink(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
