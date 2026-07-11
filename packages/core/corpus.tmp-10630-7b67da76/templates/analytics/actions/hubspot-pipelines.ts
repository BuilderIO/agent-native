import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getDealPipelines, getVisiblePipelines } from "../server/lib/hubspot";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description: "Get HubSpot deal pipelines and their stages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    return { pipelines };
  },
});
