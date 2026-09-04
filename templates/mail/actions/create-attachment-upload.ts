import { defineAction } from "@agent-native/core/action";
import {
  getAppProductionUrl,
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
    "Create a short-lived authenticated Mail upload URL for one local attachment. Upload the file bytes with HTTP PUT, then pass the returned attachment handle to ask_app so Mail can include it in a draft or approved send. Creating the URL does not send email.",
  schema: z.object({
    originalName: originalNameSchema.describe(
      "Display filename, including its extension (for example, report.png)",
    ),
  }),
  run: async ({ originalName }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Authentication required");
    const ticket = await createAttachmentUploadTicket(ownerEmail, originalName);
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
      next: "PUT the raw local file bytes to uploadUrl with the returned Authorization header before passing attachment to ask_app. Do not paste base64 into chat or action arguments.",
    };
  },
});
