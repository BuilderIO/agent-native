import { defineAction } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";
import { z } from "zod";

function isFailureStatus(status: string | null | undefined): boolean {
  return status === "error" || status === "paused";
}

/**
 * The Tasks surface lists the recurring scheduled runs this app owns. It reads the
 * framework's automation store, so a task created in the dialog and a task the
 * scheduler actually runs are the same record.
 */
export default defineAction({
  description:
    "List the scheduled tasks this workspace has for this app, with their schedule, next run and last status.",
  agentTool: true,
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (_input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const definitions = await listAutomationDefinitions(
      {
        userEmail,
        ...(ctx?.orgId ? { orgId: ctx.orgId } : {}),
        ...(ctx?.appId ? { appId: ctx.appId } : {}),
      },
      "personal",
    );
    return definitions
      .filter(
        (definition) =>
          definition.meta.triggerType === undefined ||
          definition.meta.triggerType === "schedule",
      )
      .map((definition) => ({
        id: definition.resource.id,
        name: definition.name,
        scope: "personal" as const,
        schedule: definition.meta.schedule ?? "",
        timezone: definition.meta.timezone ?? "UTC",
        body: definition.body,
        enabled: definition.meta.enabled !== false,
        nextRun: definition.meta.nextRun ?? null,
        expiresAt: definition.meta.expiresAt ?? null,
        // Where a finished run is delivered (user, group or Slack channel); a
        // task with no destination says so instead of implying one.
        delivery: definition.meta.deliveryPlatform
          ? {
              platform: definition.meta.deliveryPlatform,
              destination: definition.meta.deliveryDestination ?? null,
            }
          : null,
        lastRun: definition.meta.lastRun ?? null,
        lastStatus: definition.meta.lastStatus ?? null,
        lastError: isFailureStatus(definition.meta.lastStatus)
          ? (definition.meta.lastError ?? null)
          : null,
        canUpdate: definition.canUpdate,
      }));
  },
});
