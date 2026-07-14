import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api.js";
import { lookupBuilderCmsSafeModelIntent } from "./_builder-cms-intent-lookup.js";
import { readBuilderCmsEntryLiveState } from "./_builder-cms-read-client.js";

export default defineAction({
  description:
    "Read-only reconciliation lookup in the safe Builder test model by exact durable execution marker or exact title. Returns count, IDs, timestamps, publication state, and a fresh semantic body hash.",
  schema: z
    .object({
      marker: z.string().min(1).optional(),
      exactTitle: z.string().min(1).optional(),
    })
    .refine((value) => Boolean(value.marker) !== Boolean(value.exactTitle), {
      message: "Provide exactly one of marker or exactTitle.",
    }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const result = await lookupBuilderCmsSafeModelIntent(args);
    return {
      ...result,
      matches: await Promise.all(
        result.matches.map(async (match) => {
          const live = await readBuilderCmsEntryLiveState({
            model: BUILDER_CMS_SAFE_WRITE_MODEL,
            entryId: match.id,
          });
          return { ...match, blocksHash: live.blocksHash };
        }),
      ),
    };
  },
});
