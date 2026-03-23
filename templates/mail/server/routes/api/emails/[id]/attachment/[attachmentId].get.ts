import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { google } from "googleapis";
import { isConnected, getClients } from "../../../../lib/google-auth.js";

export default defineEventHandler(async (event) => {
  if (!isConnected()) {
    setResponseStatus(event, 404);
    return { error: "No Google account connected" };
  }

  const messageId = getRouterParam(event, "id") as string;
  const attachmentId = decodeURIComponent(
    getRouterParam(event, "attachmentId") as string,
  );

  const clients = getClients();
  for (const { client } of clients) {
    try {
      const gmail = google.gmail({ version: "v1", auth: client });
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: attachmentId,
      });

      const data = res.data.data;
      if (!data) {
        continue;
      }

      const buffer = Buffer.from(data, "base64url");

      setResponseHeader(event, "Cache-Control", "public, max-age=31536000");
      setResponseHeader(event, "Content-Length", String(buffer.length));

      return buffer;
    } catch {
      // Try next account
      continue;
    }
  }

  setResponseStatus(event, 404);
  return { error: "Attachment not found" };
});
