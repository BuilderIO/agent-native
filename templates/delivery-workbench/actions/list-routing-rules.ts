import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listRoutingRules } from "../server/lib/work-items.js";

export default defineAction({
  description: "List delivery routing rules visible to the current user.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: listRoutingRules,
});
