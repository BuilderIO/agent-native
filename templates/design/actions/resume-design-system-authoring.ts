import { defineAction } from "@agent-native/core/action";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Resume the existing authoring identity or add an empty authoring workspace to a legacy design system without replacing imported tokens or defaults. Requires editor access.",
  schema: z.object({
    id: z.string().min(1).describe("Existing design system ID"),
  }),
  run: ({ id }) => designSystemAuthoring.resume(id),
});
