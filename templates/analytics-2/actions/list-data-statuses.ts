import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataStatusSchema,
  dataStatusesOutputSchema,
} from "../app/lib/model/data-status-contracts.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { listStatuses } from "../server/model/statuses-store.js";

export default defineAction({
  description:
    "Read the current workspace's complete status catalogue for data resources.",
  schema: z.object({}).strict(),
  outputSchema: dataStatusesOutputSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    const statuses = await listStatuses({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
    });
    return {
      defaultStatusId: statuses.find((status) => status.isDefault)?.id ?? null,
      statuses: statuses.map((status) => dataStatusSchema.parse(status)),
    };
  },
});
