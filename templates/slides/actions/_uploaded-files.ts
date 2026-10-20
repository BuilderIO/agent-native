import fs from "fs";
import path from "path";

import { fail, type ActionRunContext } from "@agent-native/core/action";
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
  /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?document(?: file)?$/i;
const GENERIC_ATTACHMENT_REFERENCE =
  /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?(?:file|attachment)$/i;
const FORMAT_DOCUMENT_REFERENCES = [
  {
    extension: ".docx",
    pattern:
      /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?(?:word document|word doc|docx)(?: file)?$/i,
  },
  {
    extension: ".pdf",
    pattern:
      /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?pdf(?: document| file)?$/i,
  },
  {
    extension: ".pptx",
    pattern:
      /^(?:(?:the|this|that|a|an) )?(?:(?:current|attached|uploaded) )?(?:pptx|presentation|powerpoint presentation)(?: file)?$/i,
  },
] as const;
const IMAGE_ATTACHMENT_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

function isDocumentAttachment(
  attachment: NonNullable<ActionRunContext["attachments"]>[number],
): boolean {
  const contentType = (attachment as { contentType?: unknown }).contentType;
  return (
    (attachment.type === "file" || attachment.type === "document") &&
    !(
      typeof contentType === "string" &&
      contentType.toLowerCase().startsWith("image/")
    ) &&
    !IMAGE_ATTACHMENT_EXTENSION.test(attachment.name)
  );
}

function hasExpectedExtension(
  filename: string,
  expectedExtensions?: readonly string[],
): boolean {
  return (
    !expectedExtensions ||
    expectedExtensions.includes(path.extname(filename).toLowerCase())
  );
}

function assertExpectedExtension(
  filename: string,
  expectedExtensions?: readonly string[],
): void {
  if (!hasExpectedExtension(filename, expectedExtensions)) {
    const formats = expectedExtensions?.join(", ") ?? "";
    fail(`File "${filename}" does not match the expected format: ${formats}`, {
      errorCode: "unsupported_file_format",
      statusCode: 422,
    });
  }
}

/**
 * Resolve a name or URL through the current turn's stamped upload. If the model
 * cannot reproduce a name, only a generic phrase that identifies one eligible
 * attachment may use its stamped reference.
 */
function stampedReference(
  filePath: string,
  attachments: ActionRunContext["attachments"],
  expectedExtensions?: readonly string[],
): string | null {
  const wanted = filePath.trim();
  const candidates = attachments ?? [];
  const exactMatches = candidates.filter(
    (attachment) => attachment.name === wanted || attachment.url === wanted,
  );
  if (exactMatches.length > 0) {
    if (
      exactMatches.some(
        (attachment) =>
          !hasExpectedExtension(attachment.name, expectedExtensions),
      )
    ) {
      return null;
    }
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

  const normalizedWanted = wanted.replace(/\s+/g, " ");
  const formatReference = FORMAT_DOCUMENT_REFERENCES.find(({ pattern }) =>
    pattern.test(normalizedWanted),
  );
  if (
    formatReference &&
    expectedExtensions &&
    !expectedExtensions.includes(formatReference.extension)
  ) {
    return null;
  }
  const genericDocument = GENERIC_DOCUMENT_REFERENCE.test(normalizedWanted);
  const genericAttachment = GENERIC_ATTACHMENT_REFERENCE.test(normalizedWanted);
  if (!genericDocument && !genericAttachment && !formatReference) return null;

  const eligible = genericAttachment
    ? candidates
    : candidates.filter(isDocumentAttachment).filter((attachment) => {
        const extension = path.extname(attachment.name).toLowerCase();
        return (
          (!formatReference || extension === formatReference.extension) &&
          hasExpectedExtension(attachment.name, expectedExtensions)
        );
      });
  if (eligible.length !== 1) return null;
  if (!hasExpectedExtension(eligible[0]!.name, expectedExtensions)) return null;

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
  options?: { expectedExtensions?: readonly string[] },
): Promise<{ data: Buffer; filename: string }> {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");

  const reference = isAttachmentRef(filePath)
    ? filePath
    : (stampedReference(
        filePath,
        ctx?.attachments,
        options?.expectedExtensions,
      ) ?? filePath);
  if (isAttachmentRef(reference)) {
    const { data, filename } = unwrapAttachment(
      await resolveUploadedReference(reference, email),
    );
    assertExpectedExtension(filename, options?.expectedExtensions);
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
  const filename = path.basename(resolved);
  assertExpectedExtension(filename, options?.expectedExtensions);
  return {
    data: await fs.promises.readFile(resolved),
    filename,
  };
}
