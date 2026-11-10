import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdFromAutomationName } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  auditedRequestSummary,
  runProviderOperation,
} from "../server/lib/provider-operation.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { failWorkflowAction } from "../server/lib/workflow-action-errors.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";

type Args = { operationId: string; fields?: Record<string, unknown> };

/**
 * A request whose endpoint a person typed is audited as chat's
 * `provider-api-request` is: the method, the provider and the path with
 * anything that looks like a credential masked. The query is left out whole.
 */
function typedRequestSummary(args: Args): string | undefined {
  const def = OPERATION_CATALOG.get(args.operationId);
  if (def?.implementation.type !== "provider-request") return undefined;
  const { freeForm } = def.implementation;
  if (!freeForm) return undefined;
  return auditedRequestSummary(
    def.credential.provider,
    args.fields?.[freeForm.path],
  );
}

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Run one provider operation from the workflow catalog (a Source, Lookup or Action node that calls a provider API: HubSpot, Pylon, Stripe, Gong, PostHog, BigQuery, Jira, Notion, Sentry, GitHub search, Slack user lookup). Only a workflow job whose saved graph names operationId may call it. The request comes from the code catalog, never from the caller: pass only field values, plus cursor, window and limit for a Source. An apiRequest operation is the one open endpoint: it sends a GET to the path a graph author typed, with optional query, headers, timeout and paging, on the provider's own host and with the connection's credential. Returns the provider's JSON as output (trimmed with truncated: true past the size budget), and for a Source the normalized items and the next cursor; a write also returns externalRef and url. A response that does not match the catalog's mapping fails with unexpected_response. Errors ending _outcome_unknown mean a write may already have happened: check, never retry.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    operationId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("A catalog operation id such as hubspot.newLeads."),
    fields: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The operation's declared fields, by name."),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "A cursor Source's stored position. Omit on its first run: the request then asks for the newest page.",
      ),
    window: z
      .strictObject({
        from: z.string().trim().min(1).max(64),
        to: z.string().trim().min(1).max(64),
      })
      .optional()
      .describe("A window Source's span, as ISO timestamps."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("A Source's most items to return."),
    prime: z
      .boolean()
      .optional()
      .describe(
        "A cursor Source's first live run: take the position and return no items.",
      ),
  }),
  http: false,
  mcpTool: false,
  // The catalog, not the HTTP method, says whether this reads: a read that
  // POSTs (a CRM search, a SQL query) is still a read and may be retried.
  planMode: {
    effect: (args: Args) =>
      OPERATION_CATALOG.get(args.operationId)?.effect ?? "unknown",
    description:
      "Plan mode runs only operations the catalog declares as reads.",
  },
  retrySafe: (args: Args) =>
    OPERATION_CATALOG.get(args.operationId)?.effect === "read",
  audit: {
    recordInputs: false,
    target: (args: Args) => ({
      type: "workflow-operation",
      id: args.operationId,
      visibility: "org",
    }),
    summary: (args: Args, _result: unknown, meta: { status: string }) =>
      typedRequestSummary(args) ??
      (meta.status === "success"
        ? `Ran ${args.operationId}`
        : `Tried to run ${args.operationId}`),
  },
  run: async (
    {
      factoryId: requestedFactoryId,
      operationId,
      fields,
      cursor,
      window,
      limit,
      prime,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const factoryId =
      requestedFactoryId ??
      (context?.automation
        ? factoryIdFromAutomationName(context.automation.triggerName)
        : null);
    if (!factoryId) {
      failWorkflowAction({
        message:
          "This action needs a factoryId, or a calling workflow job that belongs to one factory.",
        errorCode: "factory_id_required",
        statusCode: 400,
      });
    }
    await requireFactoryAutomation(
      context,
      { userEmail, orgId },
      "workflow",
      factoryId,
      { operationId },
    );

    const def = OPERATION_CATALOG.get(operationId);
    if (!def || def.implementation.type !== "provider-request") {
      return failWorkflowAction({
        message: `${operationId} is not a provider operation this action can run.`,
        errorCode: "operation_not_in_catalog",
        statusCode: 404,
        details: { operationId },
      });
    }
    if (prime && (!def.cursor || cursor !== undefined)) {
      return failWorkflowAction({
        message: `${def.id} can only prime a cursor it has not stored yet.`,
        errorCode: "operation_fields_invalid",
        statusCode: 400,
        details: { operationId: def.id },
      });
    }

    return runProviderOperation({
      def,
      fields,
      cursor,
      window,
      limit,
      prime,
      identity: { userEmail, orgId, factoryId },
      caller: "run-workflow-operation",
      ...(context?.signal ? { signal: context.signal } : {}),
    });
  },
});
