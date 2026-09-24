import { defineAction } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { publishBuilderDesignSystemSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Publish the reviewed Builder DSI revision when the user chooses to use it. Requires the exact remote revision and returns the workspace with its confirmed publication receipt; an interrupted response is not publication success.",
  agentTool: false,
  schema: publishBuilderDesignSystemSchema,
  run: (args) => designSystemAuthoring.publishBuilder(args),
});
