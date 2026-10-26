import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  HUBSPOT_DUE_CHOICES,
  createHubSpotTask,
} from "../server/connectors/hubspot-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Create one HubSpot task for a workflow, through the workspace's connected HubSpot. due is today, tomorrow or nextWeek and becomes the end of that day in UTC. With a contactId the task is associated with that contact and, when no ownerId is given, assigned to the contact's owner. Returns the task id. HubSpot has no idempotency key: when the error code ends in _outcome_unknown the task may exist, so look for it before creating another.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    title: z.string().trim().min(1).max(255),
    ownerId: z.string().trim().max(20).optional(),
    contactId: z.string().trim().max(20).optional(),
    due: z.enum(HUBSPOT_DUE_CHOICES).default("today"),
    body: z.string().trim().max(10_000).optional(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (_args: unknown, result: unknown) => ({
      type: "hubspot-task",
      id: (result as { id?: string } | undefined)?.id,
      visibility: "org",
    }),
    summary: (args: { title: string }) =>
      `Created the HubSpot task "${args.title.slice(0, 120)}"`,
  },
  run: async (
    { factoryId: requestedFactoryId, title, ownerId, contactId, due, body },
    context,
  ) => {
    await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const task = await createHubSpotTask({
      title,
      ownerId: ownerId || undefined,
      contactId: contactId || undefined,
      due,
      body: body || undefined,
    });
    return { ok: true as const, ...task };
  },
});
