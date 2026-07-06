import { defineAction } from "@agent-native/core";

import {
  buildSecondaryCohort,
  secondaryCohortConfigSchema,
} from "../server/lib/secondary-cohort";

export default defineAction({
  readOnly: true,
  timeoutMs: 90_000,
  description:
    "Build a secondary provider cohort by joining Pylon sentiment to HubSpot deals using caller-supplied property names (segment filter, join keys, rollup fields). Excludes accounts already flagged in the CRM status property.",
  schema: secondaryCohortConfigSchema,
  http: { method: "POST" },
  run: async (args) => {
    const accounts = await buildSecondaryCohort(args);
    return {
      accounts,
      total: accounts.length,
      guidance:
        "Joined Pylon risk sentiment to HubSpot deals via company join keys, filtered by companySegmentProperty/companySegmentValue, excluding accounts with active CRM risk status.",
    };
  },
});
