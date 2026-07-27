import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { runConnectorSync } from "../server/lib/connectors.js";

export default defineAction({
  description:
    "Run one configured Brain source connector immediately. Slack scans allow-listed channels; Granola polls accessible notes; GitHub imports approved repository issues and PRs.",
  schema: z.object({
    sourceId: z.string().min(1),
  }),
  run: async ({ sourceId }) => {
    const access = await assertAccess("brain-source", sourceId, "editor");
    return runConnectorSync(access.resource);
  },
});
