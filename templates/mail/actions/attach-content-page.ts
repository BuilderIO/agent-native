import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  attachmentNameForFile,
  CONTENT_FILE_FORMATS,
  CONTENT_PDF_FONTS,
  contentFileFormatSchema,
  contentPageKindSchema,
  readContentPageFile,
} from "../server/lib/content-page-files.js";
import {
  attachmentFromUpload,
  extensionForUpload,
  MediaStorageSetupError,
  storeMediaUpload,
} from "../server/lib/media-upload.js";

const attachContentPageOutputSchema = z.object({
  attachment: z.object({
    id: z.string(),
    filename: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    size: z.number().nonnegative(),
    url: z.string().optional(),
  }),
  page: z.object({
    id: z.string(),
    title: z.string(),
    kind: contentPageKindSchema,
    format: contentFileFormatSchema,
  }),
  next: z.string(),
});

export default defineAction({
  description:
    "Turn a Content page into an email attachment: a page as a PDF or Markdown file, a collection as a CSV. A PDF is set in sans type unless you ask for serif, which suits poetry and other literary pages. Content reads it under the user's own access, and Mail stores the file. Then pass the returned attachment in manage-draft's attachments to put it on a draft. Find pages with list-content-pages. Attaching does not send email.",
  schema: z.object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The Content page or collection id from list-content-pages."),
    format: z
      .enum(CONTENT_FILE_FORMATS)
      .optional()
      .describe(
        "pdf or markdown for a page, csv for a collection. Defaults to markdown for a page and csv for a collection.",
      ),
    font: z
      .enum(CONTENT_PDF_FONTS)
      .optional()
      .describe(
        "Typeface for a PDF: sans (the default) or serif. Markdown and CSV ignore it.",
      ),
  }),
  outputSchema: attachContentPageOutputSchema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async ({ id, format, font }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to attach a Content page.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }
    const file = await readContentPageFile({ id, format, font });
    const originalName = attachmentNameForFile(file);
    const orgId = getRequestOrgId();
    let stored;
    try {
      stored = await storeMediaUpload({
        ownerEmail,
        ...(orgId ? { orgId } : {}),
        data: file.data,
        filename: nanoid(12) + extensionForUpload(originalName),
        originalName,
      });
    } catch (error) {
      if (error instanceof MediaStorageSetupError) {
        fail(error.message, {
          statusCode: 503,
          errorCode: "storage_setup_required",
          details: { storageSetupReason: error.reason },
        });
      }
      throw error;
    }
    const attachment = await attachmentFromUpload(ownerEmail, {
      filename: stored.filename,
      originalName: stored.originalName,
    });
    if (!attachment) {
      fail("The file was stored but could not be found. Try again.", {
        statusCode: 500,
        errorCode: "content_attachment_missing",
      });
    }
    return {
      attachment,
      page: {
        id: file.id,
        title: file.title,
        kind: file.kind,
        format: file.format,
      },
      next: "Pass attachment in manage-draft's attachments, with the files already on the draft, to put it on a draft. The draft has no file until then.",
    };
  },
});
