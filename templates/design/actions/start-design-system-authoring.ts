import { defineAction } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { startDesignSystemAuthoringSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Reserve one design-system workspace and native conversation from a fresh intent or complete source batch. Reuse requestId for identical retries. Use run-design-system-agent after direction is clear to generate through Builder; reservation is not generation and never changes defaults.",
  schema: startDesignSystemAuthoringSchema,
  run: (args) => designSystemAuthoring.start(args),
});
