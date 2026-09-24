import { defineAction } from "@agent-native/core/action";
import { updateDesignSystemWorkspaceSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Append source references, record actual source evidence or native run progress, and save workspace selection/return context. Requires workspace expectedRevision; preserves all existing artifacts. Failed work must include its error.",
  schema: updateDesignSystemWorkspaceSchema,
  run: (args) => designSystemAuthoring.update(args),
});
