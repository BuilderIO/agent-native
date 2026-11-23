import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dataCategoryListSchema } from "../app/lib/model/data-resource-contracts.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readDataCategories } from "../server/model/data-resource-metadata.js";

export default defineAction({
  description:
    "List the organisation-wide data category catalogue used by warehouse annotations.",
  schema: z.object({}).strict(),
  outputSchema: dataCategoryListSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    return readDataCategories({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
    });
  },
});
