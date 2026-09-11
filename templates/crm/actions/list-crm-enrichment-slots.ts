import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CRM_ENRICHMENT_SLOT_UNIT_COST,
  resolveEnrichmentBudgetUnits,
} from "../server/lib/enrichment-cost.js";
import { describeEnrichmentSlots } from "../server/lib/enrichment-slots.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export default defineAction({
  description:
    "List the CRM enrichment slots with their credential state and unit price. A slot is a capability (company, person, contact, web, calls), not a vendor — which provider backs a slot is an internal binding and never appears here. Each slot reports credential.status as granted, missing (with a reason), or unknown (the lookup itself failed, which is NOT the same as missing). Slots in the verify phase are free-standing evidence gathering; the spend phase slots carry contact data and are the ones the approval gate protects. Call this before estimate-crm-enrichment to see which slots a run can actually use.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    requireCrmScope(ctx);
    const slots = await describeEnrichmentSlots();
    return {
      budgetUnitsPerPeriod: resolveEnrichmentBudgetUnits(),
      slots: slots.map((slot) => ({
        ...slot,
        unitCost: CRM_ENRICHMENT_SLOT_UNIT_COST[slot.slot],
      })),
    };
  },
});
