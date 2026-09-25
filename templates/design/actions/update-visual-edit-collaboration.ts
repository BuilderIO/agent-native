import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertVisualEditAccountEditor } from "../server/lib/visual-edit-collaboration.js";

export default defineAction({
  description:
    "Enable or disable shared live HTML previews for a Design. Requires a signed-in account with editor access; disabled by default.",
  requiresAuth: true,
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID."),
      enabled: z
        .boolean()
        .describe("Whether people without the owner's localhost may view it."),
    })
    .strict(),
  run: async ({ designId, enabled }) => {
    await assertVisualEditAccountEditor(designId);

    await getDb()
      .update(schema.designs)
      .set({
        liveCollaborationEnabled: enabled,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.designs.id, designId));

    return { designId, enabled };
  },
});
