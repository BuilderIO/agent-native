import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readProjectCollections } from "../server/model/collections-store.js";

export default defineAction({
  description:
    "Read which collections each of the member's projects is filed into.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    assignments: z.array(
      z.object({
        projectId: z.string().min(1),
        collectionIds: z.array(z.string()),
      }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    return {
      assignments: await readProjectCollections({
        ownerEmail: current.ownerEmail,
        orgId: current.orgId,
      }),
    };
  },
});
