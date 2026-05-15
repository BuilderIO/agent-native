import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { assertAccess } from "@agent-native/core/sharing";
import { runConnectorSync } from "../server/lib/connectors.js";

export default defineAction({
  description:
    "Run a configured Brain source connector. Slack and Granola are practical v1 skeletons driven by source config.",
  schema: z.object({
    sourceId: z.string().min(1),
  }),
  run: async ({ sourceId }) => {
    const access = await assertAccess("brain-source", sourceId, "editor");
    return runConnectorSync(access.resource);
  },
});
