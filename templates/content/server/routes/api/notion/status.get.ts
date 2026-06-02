import { defineEventHandler } from "h3";
import {
  buildNotionAuthUrl,
  getDocumentOwnerEmail,
  getNotionConnectionForOwner,
} from "../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  const connection = await getNotionConnectionForOwner(owner);

  if (connection) {
    return {
      connected: true,
      workspaceName: connection.workspaceName,
      workspaceId: connection.workspaceId,
      authUrl: null,
      mode: "oauth" as const,
    };
  }

  // Not connected — check what's available
  const hasOAuthCredentials =
    !!process.env.NOTION_CLIENT_ID && !!process.env.NOTION_CLIENT_SECRET;

  return {
    connected: false,
    workspaceName: null,
    workspaceId: null,
    authUrl: hasOAuthCredentials ? buildNotionAuthUrl(event) : null,
    error: "missing_credentials" as const,
    mode: null,
  };
});
