import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { listOwnedPrivateIcons } from "../server/lib/private-icon-authority.js";
import { resolveEditablePrivateIconOrgId } from "../server/lib/private-icon-target.js";

export default defineAction({
  description:
    "List private image icons uploaded by the current user for reuse.",
  http: { method: "GET" },
  readOnly: true,
  schema: z.object({ documentId: z.string().min(1).max(128) }).strict(),
  run: async ({ documentId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      throw new Error("Authentication is required to list private icons.");
    return {
      assets: await listOwnedPrivateIcons({
        ownerEmail,
        orgId: await resolveEditablePrivateIconOrgId(documentId),
      }),
    };
  },
});
