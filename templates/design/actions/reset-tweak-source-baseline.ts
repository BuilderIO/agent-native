import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { mutateDesignData } from "../server/lib/design-data-mutation.js";

export default defineAction({
  description:
    "Reset a design's tweak source baseline to its persisted tweak selections after an unreadable baseline paused editing.",
  schema: z.object({ designId: z.string() }),
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  run: async ({ designId }) => {
    await assertAccess("design", designId, "editor");
    const { data } = await mutateDesignData({
      designId,
      mutate: (current) => {
        const selections = current.tweakSelections;
        const safeSelections =
          selections &&
          typeof selections === "object" &&
          !Array.isArray(selections)
            ? selections
            : {};
        return { ...current, tweakSourceBaseline: safeSelections };
      },
      isApplied: (current) => {
        const selections = current.tweakSelections;
        const safeSelections =
          selections &&
          typeof selections === "object" &&
          !Array.isArray(selections)
            ? selections
            : {};
        return (
          JSON.stringify(current.tweakSourceBaseline ?? {}) ===
          JSON.stringify(safeSelections)
        );
      },
    });
    return { designId, tweakSourceBaseline: data.tweakSourceBaseline };
  },
});
