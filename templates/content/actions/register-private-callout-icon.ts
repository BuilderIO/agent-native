import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { registerPrivateCalloutIcon } from "../server/lib/private-icon-references.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Authorize an uploaded image icon for a callout in one editable Content page.",
  schema: z
    .object({ documentId: z.string().min(1), assetId: z.string().uuid() })
    .strict(),
  run: async ({ documentId, assetId }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Authentication is required.");
    const access = await assertDocumentMutationAccess(documentId, "editor");
    await registerPrivateCalloutIcon({
      documentId,
      assetId,
      userEmail,
      ownerEmail: access.resource.ownerEmail as string,
      orgId: (access.resource.orgId as string | null) ?? null,
    });
    return { documentId, assetId };
  },
});
