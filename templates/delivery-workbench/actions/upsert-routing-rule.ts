import { defineAction } from "@agent-native/core";

import {
  routingRuleInputSchema,
  upsertRoutingRule,
} from "../server/lib/work-items.js";

export default defineAction({
  description:
    "Create or update a delivery routing rule for supervisor-owned assignment suggestions.",
  schema: routingRuleInputSchema,
  run: upsertRoutingRule,
});
