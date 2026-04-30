import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDealPipelines, getVisiblePipelines } from "../server/lib/hubspot";

export default defineAction({
  description: "Get HubSpot deal pipelines and their stages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    return { pipelines };
  },
});
