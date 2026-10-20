import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { gmailGetAttachment } from "../../lib/google-api.js";
import {
  getClientForConnectedAccount,
  isConnected,
} from "../../lib/google-auth.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const userEmail = session.email;

  if (!(await isConnected(userEmail))) {
    setResponseStatus(event, 404);
    return { error: "No Google account connected" };
  }

  const { messageId, id, mimeType } = getQuery(event) as {
    messageId?: string;
    id?: string;
    mimeType?: string;
  };

  if (!messageId || !id) {
    setResponseStatus(event, 400);
    return { error: "messageId and id are required" };
  }

  const SAFE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
  ]);
  const contentType =
    mimeType && SAFE_TYPES.has(mimeType)
      ? mimeType
      : "application/octet-stream";

  const accounts = await listOAuthAccountsByOwner("google", userEmail);
  for (const account of accounts) {
    try {
      const client = await getClientForConnectedAccount(
        userEmail,
        account.accountId,
      );
      if (!client) continue;

      const res = await gmailGetAttachment(client.accessToken, messageId, id);
      const data = res.data;
      if (!data) {
        continue;
      }

      const buffer = Buffer.from(data, "base64url");

      setResponseHeader(event, "Cache-Control", "private, max-age=31536000");
      setResponseHeader(event, "Content-Length", String(buffer.length));
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      setResponseHeader(event, "Content-Type", contentType);

      return buffer;
    } catch {
      continue;
    }
  }

  setResponseStatus(event, 404);
  return { error: "Attachment not found" };
});
