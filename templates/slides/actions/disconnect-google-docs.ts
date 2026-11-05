import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { disconnectGoogleDocs } from "../server/lib/google-docs-oauth.js";

export default defineAction({
  description:
    "Disconnect the caller's own Google Drive account from Slides by removing its stored Google Docs OAuth tokens. The caller can reconnect later. Workspace-shared Drive access is not affected, so it only removes the caller's own account.",
  schema: z.object({}),
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    await disconnectGoogleDocs(owner);
    return { ok: true };
  },
});
