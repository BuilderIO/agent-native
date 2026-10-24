import { defineAction, fail } from "../../action.js";
import { decide } from "../decide.js";
import { DecideInputSchema } from "../validation.js";

export default defineAction({
  description:
    "Make a read-only typed decision from text, JSON, or an image URL using the configured decision provider order. Returns keyed predicate probabilities, choices, or rubric scores. It does not execute the decision or change app state.",
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
