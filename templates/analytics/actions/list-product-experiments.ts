import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { listProductExperiments } from "../server/lib/product-experiments.js";
export default defineAction({
  description: "List product experiments for the active organization.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) =>
    listProductExperiments(await requireAnalyticsAdminContext(ctx)),
});
