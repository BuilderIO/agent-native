import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { google } from "googleapis";
import { isConnected, getClients } from "../../lib/google-auth.js";

export default defineEventHandler(async (event) => {
  if (!isConnected()) {
    setResponseStatus(event, 404);
    return { error: "No Google account connected" };
  }

  const { messageId, id } = getQuery(event) as {
    messageId?: string;
    id?: string;
  };

  if (!messageId || !id) {
    setResponseStatus(event, 400);
    return { error: "messageId and id are required" };
  }

  const clients = await getClients();
  for (const { client } of clients) {
    try {
      const gmail = google.gmail({ version: "v1", auth: client });
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id,
      });

      const data = res.data.data;
      if (!data) {
        continue;
      }

      const buffer = Buffer.from(data, "base64url");

      setResponseHeader(event, "Cache-Control", "private, max-age=31536000");
      setResponseHeader(event, "Content-Length", buffer.length);
      // X-Content-Type-Options prevents MIME sniffing of HTML for XSS
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      setResponseHeader(event, "Content-Type", "application/octet-stream");

      return buffer;
    } catch {
      // Try next account
      continue;
    }
  }

  setResponseStatus(event, 404);
  return { error: "Attachment not found" };
});
