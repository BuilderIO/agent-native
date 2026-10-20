import { defineAction, fail } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  checkWorkflowGraph,
  prepareWorkflowGraph,
  requireWorkflow,
  resolveWorkflowScope,
  syncJobAfterGraphChange,
  withWorkflowFailures,
  workflowCanvasPath,
  workflowVersionSource,
} from "../server/lib/factory-workflow-context.js";
import { readGraphConnections } from "../server/lib/factory-workflow-graph-connections.js";
import {
  WorkflowJobError,
  createWorkflowJob,
  disableWorkflowJob,
  removeWorkflowJob,
} from "../server/lib/factory-workflow-job.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";
import { MAX_EDGES, MAX_NODES } from "../server/workflow/contract.js";

const graphInputSchema = z.strictObject({
  nodes: z.array(z.record(z.string(), z.unknown())).max(MAX_NODES),
  edges: z.array(z.record(z.string(), z.unknown())).max(MAX_EDGES),
  settings: z.record(z.string(), z.unknown()).default({}),
});

const GRAPH_TEXT_DESCRIPTION =
  "The whole graph as JSON text, never a patch: one object {nodes, edges, settings} written out as a string. Every node needs id, name, kind, position and settings; every edge needs id, from {node, port} and to {node}. Read the exact shapes, ports and operations from describe-workflow-node-catalog.";

// The agent sends the graph as JSON text: a node is a union of twelve kinds,
// which a tool schema can only advertise as an open object map, and a model
// given that wrote empty nodes. The app and HTTP callers still send the object.
const graphSchema = z.preprocess((value, ctx) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: `is not valid JSON text (${error instanceof Error ? error.message : "it did not parse"}). Pass the whole graph as one JSON object written out as a string`,
    });
    return z.NEVER;
  }
}, graphInputSchema);

type SaveOutcome = { workflowId: string; version: number; created: boolean };

const requestFields = {
  factoryId: factoryIdSchema,
  workflowId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe("Omit to create a new workflow."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\r\n]+$/, "A name is one line.")
    .optional()
    .describe("Required when creating. A name cannot change afterwards."),
  expectedVersion: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Required when updating: the version you read."),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("One line for the version list."),
};

/** Why the request itself is refused, whatever the graph holds. */
function requestProblem(input: {
  workflowId?: string;
  name?: string;
  expectedVersion?: number;
}): string | undefined {
  if (input.workflowId === undefined) {
    if (!input.name) return "A new workflow needs a name.";
    if (input.expectedVersion !== undefined) {
      return "expectedVersion is for saving an existing workflow.";
    }
  } else if (input.expectedVersion === undefined) {
    return "Saving an existing workflow needs the expectedVersion you read.";
  }
  return undefined;
}

/**
 * Opens the new workflow's canvas for the person chatting with the agent. The
 * workflow is already saved, so a failed write is reported, never thrown: the
 * agent then opens it with navigate.
 */
async function openCanvas(path: string): Promise<boolean> {
  try {
    await writeAppStateForCurrentTab("navigate", {
      view: "factory",
      path,
      _writeId: `${Date.now()}-save-factory-workflow`,
    });
    return true;
  } catch (error) {
    console.error(
      `[save-factory-workflow] could not open ${path} in the app:`,
      error,
    );
    return false;
  }
}

export default defineAction({
  description:
    "Create a workflow or save a new version of one. Pass the complete graph as JSON text in graph. It is checked against the node kinds and the operation catalog before anything is written: every problem comes back together as graph_invalid and nothing is saved. A new workflow (no workflowId, with a name) is saved disabled; an existing one needs the expectedVersion you read, and a stale one fails with version_conflict and the current version. Saving writes the job schedule through to the scheduler. Saving into an enabled workflow switches it off (disabledBySave: true): the new version needs its own clean dry run before set-factory-workflow-enabled. The result lists connections: each provider the graph needs with its status (connected, not connected, unknown), how to connect it, and the node ids that need it: call request-workflow-connection for each provider that is not connected. Creating a workflow from chat opens its canvas for the user (navigated: true); when navigated is false, open canvasPath with navigate.",
  schema: z.object({ ...requestFields, graph: graphSchema }),
  agentInputSchema: z.object({
    ...requestFields,
    graph: z.string().describe(GRAPH_TEXT_DESCRIPTION),
  }),
  // An update names the version it read, so a repeat after a lost result is
  // refused as a version conflict, never applied twice. A request or graph
  // refused up front writes nothing. A create that passes both stays an
  // unknown outcome after a failure: repeating it could save the workflow
  // twice.
  retrySafe: (input) =>
    input.workflowId !== undefined ||
    requestProblem(input) !== undefined ||
    !checkWorkflowGraph(input.graph).ok,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  link: ({ args, result }) =>
    result?.created
      ? {
          url: buildDeepLink({
            app: "factory",
            view: "factory",
            params: { factoryId: args.factoryId, workflow: result.workflowId },
            to: result.canvasPath,
          }),
          label: "Open the workflow in Factory",
        }
      : null,
  // The graph can be 256 KB; the audit row keeps the summary, not the payload.
  audit: {
    recordInputs: false,
    target: (args: { workflowId?: string }, result: unknown) => ({
      type: "factory-workflow",
      id: (result as SaveOutcome | undefined)?.workflowId ?? args.workflowId,
      visibility: "org",
    }),
    summary: (args: { name?: string }, result: unknown) => {
      const saved = result as SaveOutcome | undefined;
      return saved
        ? `${saved.created ? "Created" : "Saved"} workflow ${saved.workflowId}${args.name ? ` "${args.name}"` : ""} as version ${saved.version}`
        : "Workflow save refused";
    },
  },
  run: async (input, context) =>
    watchAgentCall(
      {
        action: "save-factory-workflow",
        input,
        context,
        factoryId: input.factoryId,
        workflowId: input.workflowId,
        graph: input.graph,
        slow: true,
      },
      (watch) =>
        withWorkflowFailures(async () => {
          const scoped = await resolveWorkflowScope(input.factoryId, context);
          watch.inOrg(scoped.orgId);
          const creating = input.workflowId === undefined;
          const problem = requestProblem(input);
          if (problem) {
            fail(problem, { errorCode: "invalid_request", statusCode: 400 });
          }

          const { graph, plan } = prepareWorkflowGraph(input.graph);
          const source = workflowVersionSource(context);

          if (creating) {
            const name = input.name as string;
            const job = await createWorkflowJob({
              orgId: scoped.orgId,
              factoryId: input.factoryId,
              ownerEmail: scoped.userEmail,
              name,
              plan,
            });
            let created;
            try {
              created = await scoped.store.createWorkflow(scoped.scope, {
                name,
                graph,
                ownerEmail: scoped.userEmail,
                automationId: job.id,
                source,
                summary: input.summary ?? "Created",
              });
            } catch (error) {
              // A job file with no workflow behind it never runs (it is disabled)
              // but would sit in the Factory's job list; take it back out.
              await removeWorkflowJob({
                orgId: scoped.orgId,
                factoryId: input.factoryId,
                automationId: job.id,
              }).catch((cleanupError) => {
                console.error(
                  `[save-factory-workflow] could not remove the job file ${job.path} after a failed create:`,
                  cleanupError,
                );
              });
              throw error;
            }
            const canvasPath = workflowCanvasPath(input.factoryId, created.id);
            return {
              workflowId: created.id,
              version: created.version,
              created: true,
              enabled: created.enabled,
              lastCleanDryRunVersion: created.lastCleanDryRunVersion,
              disabledBySave: false,
              job: { automationId: job.id, path: job.path, changed: true },
              connections: await readGraphConnections(graph, scoped),
              canvasPath,
              navigated:
                context?.caller === "tool"
                  ? await openCanvas(canvasPath)
                  : false,
            };
          }

          const workflowId = input.workflowId as string;
          const expectedVersion = input.expectedVersion as number;
          const current = await requireWorkflow(scoped, workflowId);
          if (input.name !== undefined && input.name !== current.name) {
            fail("A workflow's name cannot change after it is created.", {
              errorCode: "invalid_request",
              statusCode: 400,
            });
          }
          // The store checks expectedVersion in the same statement that bumps the
          // version, so a stale save fails there with the current version attached.
          const saved = await scoped.store.saveWorkflowGraph(scoped.scope, {
            workflowId,
            expectedVersion,
            graph,
            source,
            summary: input.summary ?? "Saved",
            createdBy: scoped.userEmail,
          });
          // A new version must earn its own clean dry run, so an enabled workflow
          // is switched off with the save: the rows first, then the job. The host
          // store already switched the flag off in the statement that saved the
          // version; what was on before is what the caller is told. A failed job
          // write never switches the rows back on.
          const disabledBySave = current.enabled || saved.enabled;
          let record = saved;
          if (disabledBySave) {
            record = {
              ...saved,
              ...(await scoped.store.setWorkflowEnabled(
                scoped.scope,
                workflowId,
                false,
              )),
            };
            if (record.automationId) {
              try {
                await disableWorkflowJob({
                  orgId: scoped.orgId,
                  factoryId: input.factoryId,
                  automationId: record.automationId,
                });
              } catch (error) {
                if (!(error instanceof WorkflowJobError)) throw error;
                fail(
                  `Version ${saved.version} was saved and the workflow switched off, but its job file could not be switched off: ${error.message} Save again to retry.`,
                  {
                    errorCode: "job_sync_failed",
                    statusCode: 500,
                    details: {
                      workflowId,
                      savedVersion: saved.version,
                      jobError: error.code,
                      disabledBySave: true,
                    },
                  },
                );
              }
            }
          }
          const job = await syncJobAfterGraphChange(scoped, record, plan);
          return {
            workflowId: saved.id,
            version: saved.version,
            created: false,
            enabled: record.enabled,
            lastCleanDryRunVersion: saved.lastCleanDryRunVersion,
            disabledBySave,
            job: job && {
              automationId: job.id,
              path: job.path,
              changed: job.changed,
            },
            connections: await readGraphConnections(graph, scoped),
          };
        }),
    ),
});
