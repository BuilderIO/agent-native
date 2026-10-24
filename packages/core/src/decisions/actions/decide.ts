import { defineAction, fail } from "../../action.js";
import { decide } from "../decide.js";
import { DecideInputSchema } from "../validation.js";

export default defineAction({
  description:
    "Make a read-only typed decision from text, JSON, or an image URL using the configured provider order. The Builder Jev proxy is verified for predicate and choice; Jev score is unverified and disabled, so score questions skip Jev and continue to the next provider. Returns keyed answers without executing the decision or changing app state.",
  schema: DecideInputSchema,
  readOnly: true,
  grounding: true,
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return decide({
      ownerEmail: ctx.userEmail,
      input: args.input,
      questions: args.questions,
      options: {
        ...args.options,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
    });
  },
});
