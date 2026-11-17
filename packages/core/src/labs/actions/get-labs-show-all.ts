import { z } from "zod";

import { defineAction } from "../../action.js";
import { labsCaller } from "../caller.js";
import { getUserLabsShowAll } from "../store.js";

export default defineAction({
  description:
    "Return whether the current user has Show all Labs features turned on.",
  schema: z.object({}),
  outputSchema: z.object({ enabled: z.boolean() }),
  // In-app only: the switch lives in Settings › Labs, and an outside agent has
  // no reason to widen the experimental features a person opted into.
  mcpTool: false,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const { email } = labsCaller(ctx);
    return { enabled: await getUserLabsShowAll(email) };
  },
});
