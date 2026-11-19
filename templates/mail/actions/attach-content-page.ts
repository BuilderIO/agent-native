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
  readContentPageFile,
} from "../server/lib/content-page-files.js";
import {
  attachmentFromUpload,
  extensionForUpload,
  MediaStorageSetupError,
  storeMediaUpload,
} from "../server/lib/media-upload.js";

export default defineAction({
  description:
    "Turn a Content page into an email attachment: a page as a Markdown file, a collection as a CSV. Content reads it under the user's own access, and Mail stores the file. Then pass the returned attachment in manage-draft's attachments to put it on a draft. Find pages with list-content-pages. Attaching does not send email.",
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
        "markdown for a page, csv for a collection. Defaults to the one that fits.",
      ),
  }),
  run: async ({ id, format }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to attach a Content page.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }
    const file = await readContentPageFile({ id, format });
    const originalName = attachmentNameForFile(file);
    let stored;
    try {
      stored = await storeMediaUpload({
        ownerEmail,
        orgId: getRequestOrgId() ?? undefined,
        data: new TextEncoder().encode(file.content),
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
