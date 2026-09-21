import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getTraceSummary, insertInstructionUpdate } from "../store.js";
import type { InstructionUpdate } from "../types.js";

const schema = z.object({
  runId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().max(200).nullable().optional(),
  target: z.enum(["agent", "developer", "skill"]),
  instruction: z.string().trim().min(1).max(10_000),
  feedback: z.string().trim().max(4_000).optional(),
});

export default defineAction({
  description:
    "Save a human-proposed instruction update for an agent output. The draft is explicit and never applied automatically.",
  schema,
  run: async (args, ctx) => {
    const userId = ctx?.userEmail;
    if (!userId)
      fail("Sign in to save instruction updates.", { statusCode: 401 });
    const summary = await getTraceSummary(args.runId, { userId });
    if (!summary)
      fail("That agent output is no longer available.", { statusCode: 404 });
    const now = Date.now();
    const update: InstructionUpdate = {
      id: `instruction-${randomUUID()}`,
      runId: args.runId,
      threadId: args.threadId ?? summary.threadId,
      target: args.target,
      instruction: args.instruction,
      feedback: args.feedback ?? "",
      status: "draft",
      userId,
      createdAt: now,
      updatedAt: now,
    };
    await insertInstructionUpdate(update);
    return update;
  },
});
