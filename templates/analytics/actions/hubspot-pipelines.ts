import { defineAction } from "@agent-native/core";
import { getDealPipelines, getVisiblePipelines } from "../server/lib/hubspot";

export default defineAction({
  description: "Get HubSpot deal pipelines and their stages.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    return { pipelines };
  },
});
