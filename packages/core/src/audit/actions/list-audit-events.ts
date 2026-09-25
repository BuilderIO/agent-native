import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveAuditReadScope } from "../read-scope.js";
import { queryAuditEventPage } from "../store.js";

/**
 * List audit-log events the current user can see — their own actions plus the
 * agent's actions on their behalf, plus rows shared with their org — scoped in
 * SQL to the caller's identity and org. Owners and admins also see the org's
 * settings and admin changes. Read-only; never exposes other tenants' rows.
 */
export default defineAction({
  description:
    "List audit-log events (who changed what, when, and whether it was you or the agent) for resources you can access. Supports filtering by target resource, actor (agent vs human), status, agent thread/turn, app, and time range, with offset paging. Use this to answer 'what did the agent change', 'who edited this record', or 'show recent changes'. Organization owners and admins pass scope 'organization' to read the organization's settings and admin trail (default model, member roles, Builder.io, and other org settings changes, including refused attempts), which is the Settings audit log.",
  schema: z.object({
    scope: z
      .enum(["accessible", "organization"])
      .optional()
      .describe(
        "'accessible' (default): your own events plus events shared with your organization. 'organization': only the organization's shared trail, for owners and admins; refused for members.",
      ),
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
      .describe("Filter by outcome. 'denied' is a refused attempt."),
    threadId: z.string().optional().describe("Filter to one agent thread."),
    turnId: z
      .string()
      .optional()
      .describe("Filter to one agent turn (a single agent response)."),
    action: z.string().optional().describe("Filter to one action name."),
    app: z
      .string()
      .optional()
      .describe("Filter to events recorded by one app id, e.g. 'mail'."),
    sinceMs: z
      .number()
      .optional()
      .describe("Only events at or after this Unix epoch (ms)."),
    beforeMs: z
      .number()
      .optional()
      .describe("Only events strictly before this Unix epoch (ms)."),
    limit: z
      .number()
      .optional()
      .describe("Max events to return (default 100, max 500)."),
    offset: z
      .number()
      .optional()
      .describe(
        "Skip this many matching events, newest first. Pass the previous page's nextOffset.",
      ),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => {
    const scope = await resolveAuditReadScope(ctx, args.scope);
    const page = await queryAuditEventPage(scope, {
      ...(args.targetType ? { targetType: args.targetType } : {}),
      ...(args.targetId ? { targetId: args.targetId } : {}),
      ...(args.actorKind ? { actorKind: args.actorKind } : {}),
      ...(args.actorEmail ? { actorEmail: args.actorEmail } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.turnId ? { turnId: args.turnId } : {}),
      ...(args.action ? { action: args.action } : {}),
      ...(args.app ? { app: args.app } : {}),
      ...(typeof args.sinceMs === "number" ? { sinceMs: args.sinceMs } : {}),
      ...(typeof args.beforeMs === "number" ? { beforeMs: args.beforeMs } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      ...(typeof args.offset === "number" ? { offset: args.offset } : {}),
    });
    return {
      events: page.events,
      count: page.events.length,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
    };
  },
});
