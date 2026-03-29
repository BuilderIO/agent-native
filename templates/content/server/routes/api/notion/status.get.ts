import { defineEventHandler } from "h3";
import {
  buildNotionAuthUrl,
  getDocumentOwnerEmail,
  getNotionConnectionForOwner,
} from "../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  const connection = await getNotionConnectionForOwner(owner);

  if (!process.env.NOTION_CLIENT_ID || !process.env.NOTION_CLIENT_SECRET) {
    return {
      connected: false,
      workspaceName: null,
      workspaceId: null,
      authUrl: null,
      error: "missing_credentials",
    };
  }

  return {
    connected: Boolean(connection),
    workspaceName: connection?.workspaceName ?? null,
    workspaceId: connection?.workspaceId ?? null,
    authUrl: buildNotionAuthUrl(event),
  };
});
