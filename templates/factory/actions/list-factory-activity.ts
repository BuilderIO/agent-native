import { defineAction } from "@agent-native/core/action";
import {
  getAuditEventById,
  queryAuditEventPage,
  resolveAuditReadScope,
} from "@agent-native/core/audit";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  cursorSchema,
  pageLimitSchema,
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";
import { createActivityFeed } from "../server/workflow-host/activity-feed.js";

export default defineAction({
  description:
    "The Activity feed, newest first, one page at a time: workflow runs (with counts and any error), changes to workflows (created, saved, enabled, disabled, restored, deleted; who made them, a person, the agent, or the schedule), and items handed to a person. Filter by workflow, who (person, agent, schedule), kind (run, change, needs_you), and a time range (since inclusive, until exclusive). Every entry carries a link: a run, a version, or an item journey. A run is attributed to the schedule, or to the person who started it; the agent is attributed only for changes. A page can be short while hasMore is true; ask again with nextCursor.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema.optional(),
    who: z.enum(["person", "agent", "schedule"]).optional(),
    kind: z.enum(["run", "change", "needs_you"]).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    limit: pageLimitSchema,
    cursor: cursorSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (input, context) =>
    withReadFailures(async () => {
      const caller = await resolveWorkflowReadScope(input.factoryId, context);
      // Changes come from the framework audit log, read as the caller.
      const auditScope = await resolveAuditReadScope(
        { userEmail: caller.userEmail, orgId: caller.orgId },
        "accessible",
      );
      const feed = createActivityFeed({
        readModels: caller.models,
        readAudit: (query) => queryAuditEventPage(auditScope, query),
        readAuditEvent: (id) => getAuditEventById(id, auditScope),
      });
      return feed.list(caller.scope, {
        ...(input.workflowId === undefined
          ? {}
          : { workflowId: input.workflowId }),
        ...(input.who === undefined ? {} : { who: input.who }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.since === undefined ? {} : { since: input.since }),
        ...(input.until === undefined ? {} : { until: input.until }),
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    }),
});
