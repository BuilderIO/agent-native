import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listNativeRenderContexts } from "./_native-render-contexts.js";

export default defineAction({
  description:
    "List live, authenticated local Design editor tab IDs available for a foreground native PNG or MP4 export of this Design. Returns bounded metadata only; an empty list means no verified live editor tab.",
  schema: z.object({ designId: z.string().min(1).max(128) }).strict(),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ designId }) => ({
    designId,
    contexts: await listNativeRenderContexts(designId),
  }),
});
