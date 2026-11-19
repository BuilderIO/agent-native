import { defineAction } from "@agent-native/core/action";
import {
  getAppProductionUrl,
  getRequestOrgId,
  getRequestUserEmail,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import { z } from "zod";

import { createAttachmentUploadTicket } from "../server/lib/attachment-upload-ticket.js";

const originalNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\\/\0\r\n]/.test(value),
    "Filename must not contain path separators or control characters",
  );

export default defineAction({
  description:
    "Create a short-lived authenticated Mail upload URL for one local attachment. Upload the file bytes with HTTP PUT, then pass the returned attachment object in manage-draft's attachments to put it on a draft. Creating the URL does not send email.",
  schema: z.object({
    originalName: originalNameSchema.describe(
      "Display filename, including its extension (for example, report.png)",
    ),
  }),
  run: async ({ originalName }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Authentication required");
    const ticket = await createAttachmentUploadTicket(
      ownerEmail,
      originalName,
      getRequestOrgId(),
    );
    const appUrl = withConfiguredAppBasePath(getAppProductionUrl());
    const uploadUrl = `${appUrl}/api/media/attachment-upload/${encodeURIComponent(ticket.uploadId)}`;
    return {
      method: "PUT" as const,
      uploadUrl,
      headers: { Authorization: `Bearer ${ticket.token}` },
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      maxBytes: 10 * 1024 * 1024,
      attachment: {
        filename: ticket.filename,
        originalName: ticket.originalName,
        mimeType: ticket.mimeType,
      },
      next: "PUT the raw local file bytes to uploadUrl with the returned Authorization header, then pass attachment in manage-draft's attachments. If the PUT fails, tell the user its error; the draft has no file until it succeeds. Do not paste base64 into chat or action arguments.",
    };
  },
});
