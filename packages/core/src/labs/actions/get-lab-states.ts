import { z } from "zod";

import { defineAction } from "../../action.js";
import { syncLabsAppState } from "../app-state.js";
import { labsCaller } from "../caller.js";
import { getUserLabsShowAll, getUserLabStates } from "../store.js";

export default defineAction({
  description:
    "Return each registered lab's effective state, including whether it comes from a saved choice or inherited feature flags.",
  schema: z.object({}),
  http: { method: "GET" },
  mcpTool: false,
  run: async (_args, ctx) => {
    const { email, scope } = labsCaller(ctx);
    const states = await getUserLabStates(email, scope);
    await syncLabsAppState(states, await getUserLabsShowAll(email));
    return states;
  },
});
