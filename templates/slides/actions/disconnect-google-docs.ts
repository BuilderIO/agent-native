import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  disconnectGoogleDocs,
  listGoogleDocsAccounts,
} from "../server/lib/google-docs-oauth.js";

export default defineAction({
  description:
    "Disconnect the caller's own Google Drive account from Slides by removing its stored Google Docs OAuth tokens. The caller can reconnect later. Workspace-shared Drive access is not affected: returns disconnected false when the caller has no account of their own to remove.",
  schema: z.object({}),
  outputSchema: z.object({ disconnected: z.boolean() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) {
      fail("Sign in to disconnect Google Drive.", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    }
    if ((await listGoogleDocsAccounts(owner)).length === 0) {
      return { disconnected: false };
    }
    await disconnectGoogleDocs(owner);
    return { disconnected: true };
  },
});
