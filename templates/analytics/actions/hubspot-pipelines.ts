import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDealPipelines, getVisiblePipelines } from "../server/lib/hubspot";

export default defineAction({
  readOnly: true,
  mcpTool: true,
  description:
    "Get the visible HubSpot deal pipelines and their stages. Pass a pipeline ID or label to hubspot-deals to filter deals.",
  schema: z.object({}),
  http: { method: "GET" },
  grounding: true,
  run: async () => {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    return { pipelines };
  },
});
