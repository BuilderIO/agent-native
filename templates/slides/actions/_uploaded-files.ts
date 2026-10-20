import fs from "fs";
import path from "path";

import type { ActionRunContext } from "@agent-native/core/action";
import {
  attachmentFailureToError,
  isAttachmentRef,
  unwrapAttachment,
} from "@agent-native/core/private-blob";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import {
  isHostedSlidesRuntime,
  tenantUploadDir,
} from "../server/lib/tenant-files.js";
import { resolveUploadedReference } from "../server/lib/uploaded-reference-storage.js";

/**
 * Resolve a name or URL through the current turn's stamped upload. If the model
 * cannot reproduce a name and there is only one upload, that reference is
 * unambiguous and safe to use.
 */
function stampedReference(
  filePath: string,
  attachments: ActionRunContext["attachments"],
): string | null {
  const wanted = filePath.trim();
  const candidates = attachments ?? [];
  const exactMatches = candidates.filter(
    (attachment) => attachment.name === wanted || attachment.url === wanted,
  );
  if (exactMatches.length > 0) {
    const matchingReferences = exactMatches.map(
      (attachment) =>
        (attachment as { slidesUploadPath?: unknown }).slidesUploadPath,
    );
    if (matchingReferences.some((reference) => typeof reference !== "string")) {
      return null;
    }
    const uniqueReferences = new Set(matchingReferences as string[]);
    return uniqueReferences.size === 1
      ? (uniqueReferences.values().next().value ?? null)
      : null;
  }
  if (/[/\\:]/.test(wanted)) return null;

  const references = new Set(
    candidates.flatMap((attachment) => {
      const stamped = (attachment as { slidesUploadPath?: unknown })
        .slidesUploadPath;
      return typeof stamped === "string" ? [stamped] : [];
    }),
  );
  return references.size === 1
    ? (references.values().next().value ?? null)
    : null;
}

/**
 * The one way a Slides action opens an uploaded file. Hosted uploads are core
 * attachment refs; local paths exist only outside hosted runtimes. Every
 * failure is a typed attachment error (a stop for definitive causes, a
 * retryable action error for a storage outage), never message text.
 */
export async function readUserUploadedFile(
  filePath: string,
  ctx?: Pick<ActionRunContext, "attachments">,
): Promise<{ data: Buffer; filename: string }> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");

  const reference = isAttachmentRef(filePath)
    ? filePath
    : (stampedReference(filePath, ctx?.attachments) ?? filePath);
  if (isAttachmentRef(reference)) {
    const { data, filename } = unwrapAttachment(
      await resolveUploadedReference(reference, email),
    );
    return { data, filename };
  }
  if (isHostedSlidesRuntime()) {
    throw attachmentFailureToError({
      status: "malformed",
      reason: "unrecognized_scheme",
    });
  }

  const allowedDir = tenantUploadDir(email);
  const absPath = path.isAbsolute(reference)
    ? reference
    : path.join(process.cwd(), reference);
  const resolved = path.resolve(absPath);

  if (
    !(resolved === allowedDir || resolved.startsWith(allowedDir + path.sep))
  ) {
    throw attachmentFailureToError({
      status: "forbiddenScope",
      reason: "path_outside_uploads",
    });
  }
  if (!fs.existsSync(resolved)) {
    throw attachmentFailureToError({
      status: "notFound",
      reason: "file_missing",
      filename: path.basename(resolved),
    });
  }
  return {
    data: await fs.promises.readFile(resolved),
    filename: path.basename(resolved),
  };
}
