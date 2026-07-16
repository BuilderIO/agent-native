import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { getProductExperiment } from "../server/lib/product-experiments.js";
export default defineAction({
  description:
    "Get one product experiment and its descriptive exposure/conversion results.",
  schema: z.object({ id: z.string().uuid() }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) =>
    getProductExperiment(await requireAnalyticsAdminContext(ctx), args.id),
});
