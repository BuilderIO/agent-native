import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCrmSavedViews } from "../server/db/crm-store.js";

export default defineAction({
  description:
    "List access-scoped saved CRM views, including their optional linked data-program IDs.",
  schema: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: (input) => listCrmSavedViews(input),
});
