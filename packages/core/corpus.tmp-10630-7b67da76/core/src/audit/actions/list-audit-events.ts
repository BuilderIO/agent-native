import { z } from "zod";

import { defineAction } from "../../action.js";
import { queryAuditEvents } from "../store.js";

/**
 * List audit-log events the current user can see — their own actions plus the
 * agent's actions on their behalf, scoped in SQL to the caller's identity and
 * org. Read-only; never exposes other tenants' rows.
 */
export default defineAction({
  description:
    "List audit-log events (who changed what, when, and whether it was you or the agent) for resources you can access. Supports filtering by target resource, actor (agent vs human), status, agent thread/turn, and time. Use this to answer 'what did the agent change', 'who edited this record', or 'show recent changes'.",
  schema: z.object({
    targetType: z
      .string()
      .optional()
      .describe("Filter to one resource type, e.g. 'recording'."),
    targetId: z
      .string()
      .optional()
      .describe("Filter to one resource id (pair with targetType)."),
    actorKind: z
      .enum(["agent", "human", "system"])
      .optional()
      .describe("Filter to changes made by the agent, a human, or the system."),
    actorEmail: z.string().optional().describe("Filter to one actor's email."),
    status: z
      .enum(["success", "error", "denied"])
      .optional()
      .describe("Filter by outcome."),
    threadId: z.string().optional().describe("Filter to one agent thread."),
    turnId: z
      .string()
      .optional()
      .describe("Filter to one agent turn (a single agent response)."),
    action: z.string().optional().describe("Filter to one action name."),
    sinceMs: z
      .number()
      .optional()
      .describe("Only events at or after this Unix epoch (ms)."),
    limit: z
      .number()
      .optional()
      .describe("Max events to return (default 100, max 500)."),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const events = await queryAuditEvents(
      { userEmail: ctx?.userEmail, orgId: ctx?.orgId ?? null },
      {
        ...(args.targetType ? { targetType: args.targetType } : {}),
        ...(args.targetId ? { targetId: args.targetId } : {}),
        ...(args.actorKind ? { actorKind: args.actorKind } : {}),
        ...(args.actorEmail ? { actorEmail: args.actorEmail } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.turnId ? { turnId: args.turnId } : {}),
        ...(args.action ? { action: args.action } : {}),
        ...(typeof args.sinceMs === "number" ? { sinceMs: args.sinceMs } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      },
    );
    return { events, count: events.length };
  },
});
