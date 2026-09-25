import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fail, defineAction } from "../../action.js";
import { getTraceSummary, insertInstructionUpdate } from "../store.js";
import type { InstructionUpdate } from "../types.js";
import { requireObservabilityOrgAdmin } from "./authorization.js";

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
    const { userId, orgId } = await requireObservabilityOrgAdmin(ctx);
    const summary = await getTraceSummary(args.runId, { orgId });
    if (!summary)
      fail("That agent output is no longer available.", { statusCode: 404 });
    if (args.threadId && args.threadId !== summary.threadId)
      fail("The thread does not match the selected run.", { statusCode: 404 });
    const now = Date.now();
    const update: InstructionUpdate = {
      id: `instruction-${randomUUID()}`,
      runId: args.runId,
      threadId: summary.threadId,
      target: args.target,
      instruction: args.instruction,
      feedback: args.feedback ?? "",
      status: "draft",
      userId,
      orgId,
      createdAt: now,
      updatedAt: now,
    };
    await insertInstructionUpdate(update);
    return update;
  },
});
