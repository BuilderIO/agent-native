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

const GENERIC_DOCUMENT_REFERENCE =
  /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?(?:word document|word doc|document|docx|pdf|pptx|powerpoint presentation|presentation)(?: file)?$/i;
const GENERIC_ATTACHMENT_REFERENCE =
  /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?(?:file|attachment)$/i;

/**
 * Resolve a name or URL through the current turn's stamped upload. If the model
 * cannot reproduce a name, only a generic phrase that identifies one eligible
 * attachment may use its stamped reference.
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

  const genericDocument = GENERIC_DOCUMENT_REFERENCE.test(
    wanted.replace(/\s+/g, " "),
  );
  const genericAttachment = GENERIC_ATTACHMENT_REFERENCE.test(
    wanted.replace(/\s+/g, " "),
  );
  if (!genericDocument && !genericAttachment) return null;

  const eligible = genericDocument
    ? candidates.filter(
        (attachment) =>
          attachment.type === "file" || attachment.type === "document",
      )
    : candidates;
  if (eligible.length !== 1) return null;

  const stamped = (eligible[0] as { slidesUploadPath?: unknown })
    .slidesUploadPath;
  return typeof stamped === "string" ? stamped : null;
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
