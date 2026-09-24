import { defineAction } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { runBuilderDesignSystemSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Send the user's direction to this workspace's persistent Builder DSI agent. Starts once with the complete staged reference batch, then refines the same Builder project. Reuse requestId only for identical retries. Returns actual session progress, not a generation or publication claim; read get-design-system-workspace for progress and artifacts.",
  schema: runBuilderDesignSystemSchema,
  run: (args) => designSystemAuthoring.runBuilder(args),
});
