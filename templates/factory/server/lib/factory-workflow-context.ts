import { fail, type ActionRunContext } from "@agent-native/core/action";
import type { z } from "zod";

import { getWorkflowStore } from "../workflow-host/factory-store.js";
import {
  WorkflowStoreError,
  type WorkflowRecord,
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowSummary,
  type WorkflowVersionSource,
} from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import {
  workflowGraphSchema,
  type WorkflowGraph,
} from "../workflow/contract.js";
import { validateWorkflowGraph } from "../workflow/graph-validation.js";
import { readFactoryDefinition } from "./factory-definitions.js";
import { DEFAULT_FACTORY_ID } from "./factory-ids.js";
import {
  WorkflowJobError,
  planWorkflowJob,
  syncWorkflowJob,
  type WorkflowJobPlan,
} from "./factory-workflow-job.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "./require-workspace-member.js";

interface WorkflowActionScope {
  userEmail: string;
  orgId: string;
  scope: WorkflowScope;
  store: WorkflowStore;
}

/** Who is calling, which factory they mean, and the store that holds its workflows. */
export async function resolveWorkflowScope(
  factoryId: string,
  context: ActionRunContext | undefined,
): Promise<WorkflowActionScope> {
  const { userEmail, orgId } = await requireWorkspaceMember(
    workspaceMemberIdentityFromContext(context),
  );
  const factory = await readFactoryDefinition(orgId, factoryId);
  if (!factory && factoryId !== DEFAULT_FACTORY_ID) {
    fail("Factory not found.", {
      errorCode: "factory_not_found",
      statusCode: 404,
    });
  }
  return {
    userEmail,
    orgId,
    scope: { orgId, factoryId },
    store: getWorkflowStore(),
  };
}

const AGENT_CALLERS: ReadonlySet<string> = new Set([
  "tool",
  "mcp",
  "webmcp",
  "a2a",
]);

/** Whether the call comes from an agent (chat, MCP, A2A) rather than the app's own UI. */
export function isAgentCaller(context: ActionRunContext | undefined): boolean {
  return Boolean(context?.caller && AGENT_CALLERS.has(context.caller));
}

/** The version row records whether a person or the agent made the change. */
export function workflowVersionSource(
  context: ActionRunContext | undefined,
): Extract<WorkflowVersionSource, "save" | "agent"> {
  return isAgentCaller(context) ? "agent" : "save";
}

function storeFailure(error: WorkflowStoreError): never {
  const details = error.details;
  switch (error.code) {
    case "not_found":
      return fail(error.message, {
        errorCode: "workflow_not_found",
        statusCode: 404,
      });
    case "already_exists":
      return fail(error.message, {
        errorCode: "workflow_exists",
        statusCode: 409,
      });
    case "stale_version":
      return fail(error.message, {
        errorCode: "version_conflict",
        statusCode: 409,
        details: { ...details },
      });
    case "dry_run_required":
      return fail(error.message, {
        errorCode: "dry_run_required",
        statusCode: 409,
        details: { ...details },
      });
    case "invalid_record":
      return fail(error.message, {
        errorCode: "workflow_invalid",
        statusCode: 422,
      });
    default:
      // corrupt_record and the run-level codes mean the store cannot be
      // trusted or a run is mid-flight: not something a caller can fix.
      throw error;
  }
}

const JOB_FAILURE_STATUS = {
  job_missing: 409,
  job_replaced: 409,
  job_conflict: 409,
  job_name_taken: 409,
  job_invalid: 422,
} as const;

/** Turns the failures a caller can act on into typed action failures. */
export async function withWorkflowFailures<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkflowStoreError) return storeFailure(error);
    if (error instanceof WorkflowJobError) {
      return fail(error.message, {
        errorCode: `workflow_${error.code}`,
        statusCode: JOB_FAILURE_STATUS[error.code],
      });
    }
    throw error;
  }
}

export async function requireWorkflow(
  context: WorkflowActionScope,
  workflowId: string,
): Promise<WorkflowRecord> {
  const workflow = await context.store.getWorkflow(context.scope, workflowId);
  if (!workflow) {
    fail(`Workflow "${workflowId}" was not found in this factory.`, {
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
  }
  return workflow;
}

/** The app route that opens a workflow's canvas. */
export function workflowCanvasPath(
  factoryId: string,
  workflowId: string,
): string {
  const query = new URLSearchParams({ factoryId, workflow: workflowId });
  return `/factory?${query}`;
}

/** A workflow without its graph, in the shape every read action returns. */
export function workflowSummaryView(summary: WorkflowSummary) {
  return {
    id: summary.id,
    automationId: summary.automationId,
    name: summary.name,
    version: summary.version,
    enabled: summary.enabled,
    lastCleanDryRunVersion: summary.lastCleanDryRunVersion,
    dryRunCurrent: summary.lastCleanDryRunVersion === summary.version,
    lastTriggerAt: summary.lastTriggerAt,
    ownerEmail: summary.ownerEmail,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

interface GraphProblem {
  source: "schema" | "graph" | "job";
  code: string;
  path?: string;
  nodeId?: string;
  edgeId?: string;
  port?: string;
  detail?: string;
}

const MAX_REPORTED_PROBLEMS = 200;
// Core shows the agent the message and the error code, never `details`, so the
// message itself carries the issues it needs to correct the graph.
const MAX_MESSAGE_PROBLEMS = 15;
const MAX_MESSAGE_DETAIL_CHARS = 240;

function describeProblem(problem: GraphProblem): string {
  const where = [
    problem.nodeId && `node ${problem.nodeId}`,
    problem.edgeId && `edge ${problem.edgeId}`,
    problem.port && `port ${problem.port}`,
    problem.path,
  ]
    .filter(Boolean)
    .join(" ");
  const detail = problem.detail?.slice(0, MAX_MESSAGE_DETAIL_CHARS);
  return `${problem.code}${where ? ` @ ${where}` : ""}${detail ? `: ${detail}` : ""}`;
}

function graphInvalid(problems: GraphProblem[]): never {
  const listed = problems.slice(0, MAX_MESSAGE_PROBLEMS).map(describeProblem);
  const more = problems.length - listed.length;
  return fail(
    [
      `The workflow graph has ${problems.length} problem${problems.length === 1 ? "" : "s"}, so nothing was saved:`,
      ...listed.map((line) => `- ${line}`),
      ...(more > 0 ? [`- ${more} more`] : []),
    ].join("\n"),
    {
      errorCode: "graph_invalid",
      statusCode: 422,
      details: {
        issueCount: problems.length,
        issues: problems.slice(0, MAX_REPORTED_PROBLEMS),
        truncated: problems.length > MAX_REPORTED_PROBLEMS,
      },
    },
  );
}

/** What zod says about one schema issue; a union that matched no branch reads as the closest branch's problems. */
function schemaIssueDetail(issue: z.core.$ZodIssue): string {
  if (issue.code !== "invalid_union" || issue.errors.length === 0) {
    return issue.message;
  }
  const closest = issue.errors.reduce((best, branch) =>
    branch.length < best.length ? branch : best,
  );
  return `no option matched; the closest needs: ${closest
    .slice(0, 3)
    .map((inner) =>
      inner.path.length > 0
        ? `${inner.path.join(".")} ${inner.message}`
        : inner.message,
    )
    .join("; ")}`;
}

/**
 * What a graph needs before it can be saved: it parses, it names only
 * operations the catalog has, and the job file can say when it runs. Every
 * problem is reported at once.
 */
export function checkWorkflowGraph(
  raw: unknown,
):
  | { ok: true; graph: WorkflowGraph; plan: WorkflowJobPlan }
  | { ok: false; problems: GraphProblem[] } {
  const parsed = workflowGraphSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        source: "schema" as const,
        code: issue.code,
        path: issue.path.join("."),
        detail: schemaIssueDetail(issue),
      })),
    };
  }
  const graph = parsed.data;
  const validation = validateWorkflowGraph(graph, OPERATION_CATALOG);
  const job = planWorkflowJob(graph);
  const problems: GraphProblem[] = [
    ...validation.issues.map((issue) => ({
      source: "graph" as const,
      ...issue,
    })),
    ...job.issues.map((issue) => ({ source: "job" as const, ...issue })),
  ];
  if (problems.length > 0 || !job.plan) return { ok: false, problems };
  return { ok: true, graph, plan: job.plan };
}

/**
 * A graph that can be saved, or `graph_invalid` listing every problem. A
 * rejection leaves nothing half written.
 */
export function prepareWorkflowGraph(raw: unknown): {
  graph: WorkflowGraph;
  plan: WorkflowJobPlan;
} {
  const checked = checkWorkflowGraph(raw);
  if (!checked.ok) return graphInvalid(checked.problems);
  return { graph: checked.graph, plan: checked.plan };
}

/**
 * Writes a saved graph's schedule and Source settings through to the job file.
 * The rows are already committed when this runs, so a failure says exactly
 * which version is saved and what is stale.
 */
export async function syncJobAfterGraphChange(
  context: WorkflowActionScope,
  workflow: WorkflowRecord,
  plan: WorkflowJobPlan,
): Promise<{ id: string; path: string; changed: boolean } | null> {
  if (!workflow.automationId) return null;
  try {
    return await syncWorkflowJob({
      orgId: context.orgId,
      factoryId: context.scope.factoryId,
      automationId: workflow.automationId,
      name: workflow.name,
      plan,
      enabled: workflow.enabled,
    });
  } catch (error) {
    if (!(error instanceof WorkflowJobError)) throw error;
    return fail(
      `Version ${workflow.version} was saved, but the job file did not follow: ${error.message} Save again to retry.`,
      {
        errorCode: "job_sync_failed",
        statusCode: 500,
        details: {
          workflowId: workflow.id,
          savedVersion: workflow.version,
          jobError: error.code,
        },
      },
    );
  }
}
