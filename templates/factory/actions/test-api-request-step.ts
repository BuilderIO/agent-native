import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { authorizeAutomationRunNow } from "@agent-native/core/triggers";
import { z } from "zod";

import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import { WORKFLOW_JOB_APP_ID } from "../server/lib/factory-workflow-runner.js";
import {
  auditedRequestSummary,
  runProviderOperation,
} from "../server/lib/provider-operation.js";
import { isWorkflowActionError } from "../server/lib/workflow-action-errors.js";
import type { TripwireSink } from "../server/tripwire/index.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import { resolveStandaloneFields } from "../server/workflow/engine/standalone-fields.js";
import { testNeedsItems } from "../server/workflow/standalone-test.js";

// Nothing about this call is kept but its audit row. A tripwire row would be one
// more thing written about a request whose answer is customer data, and the
// person who asked sees every failure in the result.
const discardTripwire: TripwireSink = () => undefined;

const requestSchema = z.object({
  provider: z.string(),
  method: z.literal("GET"),
  /** The path as the step has it, which a person typed. Never a query, header or answer. */
  path: z.string(),
});

const resultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    status: z.number().int(),
    /** The provider's JSON, bounded as a run bounds it: a cut answer leads with `truncated` and `cuts`. */
    output: z.unknown(),
    truncated: z.boolean(),
    elapsedMs: z.number().int().nonnegative(),
    request: requestSchema,
  }),
  z.object({
    ok: z.literal(false),
    /** One of the typed codes an API request step fails with. */
    code: z.string(),
    message: z.string(),
    /** The HTTP status the provider answered with, when it did. */
    status: z.number().int().optional(),
    elapsedMs: z.number().int().nonnegative(),
    request: requestSchema,
  }),
]);
type TestResult = z.infer<typeof resultSchema>;

function statusOf(details: Record<string, unknown>): number | undefined {
  const { status } = details;
  return typeof status === "number" && Number.isInteger(status)
    ? status
    : undefined;
}

export default defineAction({
  description:
    "Send one saved API request step now and hand its answer straight back, for the person testing the step in the app. Only for a Lookup that calls <provider>.apiRequest and reads nothing about an item. The request is built and sent the way a run sends it: the connection's credential, the provider's own host, the header deny-list and the same typed refusals. The answer (the provider's JSON, bounded, a cut one leading with truncated and cuts) is returned to the caller and written nowhere: only an audit row records that the request was made. Access is the same as testing the step in a run.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    nodeId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe("The API request step, as it is in the saved workflow."),
  }),
  outputSchema: resultSchema,
  http: { method: "POST" },
  readOnly: true,
  // The answer is customer data: it goes to the person's screen and nowhere else, so neither the agent nor an MCP client can ask for it.
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  mcpAnnotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  audit: {
    onRead: true,
    recordInputs: false,
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (args: { nodeId: string }, result: unknown) => {
      const sent = resultSchema.safeParse(result);
      if (!sent.success) return `Tried to test API request step ${args.nodeId}`;
      const { request } = sent.data;
      const line = auditedRequestSummary(request.provider, request.path);
      return sent.data.ok ? line : `${line} (${sent.data.code})`;
    },
  },
  run: async ({ factoryId, workflowId, nodeId }, context) =>
    withWorkflowFailures(async (): Promise<TestResult> => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const workflow = await requireWorkflow(scoped, workflowId);

      const node = workflow.graph.nodes.find(
        (candidate) => candidate.id === nodeId,
      );
      if (!node) {
        return fail(
          `Node "${nodeId}" is not in version ${workflow.version} of this workflow.`,
          {
            errorCode: "workflow_node_not_found",
            statusCode: 404,
            details: { workflowId, nodeId },
          },
        );
      }
      const def =
        node.kind === "lookup"
          ? OPERATION_CATALOG.get(node.settings.operation)
          : undefined;
      if (
        node.kind !== "lookup" ||
        def === undefined ||
        def.effect !== "read" ||
        def.implementation.type !== "provider-request" ||
        def.implementation.freeForm === undefined
      ) {
        return fail(
          `Step "${node.name}" is not an API request, so there is nothing to send. Only an API request step is tested on its own.`,
          {
            errorCode: "not_an_api_request",
            statusCode: 400,
            details: { workflowId, nodeId, nodeKind: node.kind },
          },
        );
      }
      if (testNeedsItems(node)) {
        return fail(
          `Step "${node.name}" reads the item it is given, so a test needs items to run it on and nothing was started. Pin some with sampleItemIds (ids of items a run of the whole workflow took), or run the workflow with mode dry first.`,
          {
            errorCode: "test_needs_items",
            statusCode: 409,
            details: { workflowId, nodeId, nodeKind: node.kind },
          },
        );
      }

      // The same two checks as testing the step in a run: the workflow's job is there, and
      // the caller may run it. The rule is core's own, asked without queuing anything.
      const job = workflow.automationId
        ? await findFactoryAutomationDefinition(
            scoped.orgId,
            factoryId,
            workflow.automationId,
          )
        : null;
      if (!job) {
        return fail(
          "This workflow's job file is gone, so nothing can run it. Save the workflow again to recreate it.",
          {
            errorCode: "workflow_job_missing",
            statusCode: 409,
            details: { workflowId },
          },
        );
      }
      try {
        await authorizeAutomationRunNow({
          userEmail: scoped.userEmail,
          orgId: scoped.orgId,
          appId: "factory",
          additionalJobAppIds: [WORKFLOW_JOB_APP_ID],
          scope: "organization",
          path: job.resource.path,
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        if (
          typeof statusCode === "number" &&
          statusCode >= 400 &&
          statusCode < 500
        ) {
          const message =
            error instanceof Error ? error.message : String(error);
          return fail(`The test was not run: ${message}`, {
            errorCode: "run_not_queued",
            statusCode,
            details: { workflowId },
          });
        }
        throw error;
      }

      const provider = def.credential.provider;
      const resolved = resolveStandaloneFields({
        node,
        def,
        graph: workflow.graph,
        lastTriggerAt: workflow.lastTriggerAt,
        now: new Date(),
        runId: randomUUID(),
      });
      const typedPath = resolved.ok
        ? resolved.fields[def.implementation.freeForm.path]
        : undefined;
      const request = {
        provider,
        method: "GET" as const,
        path: typeof typedPath === "string" ? typedPath.trim() : "",
      };
      if (!resolved.ok) {
        return {
          ok: false,
          code: resolved.failure.code,
          message: resolved.failure.message,
          elapsedMs: 0,
          request,
        };
      }

      const startedAt = Date.now();
      try {
        const payload = await runProviderOperation({
          def,
          fields: resolved.fields,
          identity: {
            userEmail: scoped.userEmail,
            orgId: scoped.orgId,
            factoryId,
          },
          caller: "test-api-request-step",
          tripwire: discardTripwire,
          ...(context?.signal ? { signal: context.signal } : {}),
        });
        return {
          ok: true,
          status: payload.status,
          output: payload.output,
          truncated: payload.truncated,
          elapsedMs: Date.now() - startedAt,
          request,
        };
      } catch (error) {
        if (!isWorkflowActionError(error)) throw error;
        const status = statusOf(error.details);
        return {
          ok: false,
          code: error.errorCode,
          message: error.message,
          ...(status === undefined ? {} : { status }),
          elapsedMs: Date.now() - startedAt,
          request,
        };
      }
    }),
});
