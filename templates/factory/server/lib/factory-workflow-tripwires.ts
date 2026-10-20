import type { ActionRunContext } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";

import { describeShape, recordTripwire } from "../tripwire/index.js";
import { readFactoryDefinition } from "./factory-definitions.js";
import { DEFAULT_FACTORY_ID } from "./factory-ids.js";
import { factoryIdSchema } from "./factory-scope.js";
import { isAgentCaller } from "./factory-workflow-context.js";

/** A tool call that ran longer than this is recorded at `info`, and past the second limit at `warn`. */
const SLOW_TOOL_INFO_MS = 5_000;
export const SLOW_TOOL_WARN_MS = 10_000;

const ISSUE_CODES_RECORDED = 5;
const NODE_KEY_COUNTS_RECORDED = 10;

interface ObservedAgentCall {
  action: string;
  /** The parsed input; only its top-level key names are recorded. */
  input: Record<string, unknown>;
  context: ActionRunContext | undefined;
  /** Absent for a tool that takes no factory: the open one is read from navigation if the call turns out slow. */
  factoryId?: string;
  workflowId?: string;
  /** The graph the call carries; its shape is recorded with a refusal. */
  graph?: unknown;
  /** Record the call when it ran long. Off for a call whose wait is the point. */
  slow?: boolean;
}

interface AgentCallWatch {
  /**
   * The organization the call runs in, once the action has verified that the
   * caller belongs to it and, when the call names a factory, that the factory
   * is there. Nothing is recorded before this: a factory id the caller made up
   * would otherwise key rows of its own.
   */
  inOrg(orgId: string): void;
  /**
   * Records a refusal the caller can act on (a 4xx the action raised). Observe
   * only: it never throws and the caller still gets the original error.
   */
  rejected(error: unknown): void;
  /** Records the call when it ran slowly. Call it once, from a `finally`. Never throws. */
  finished(): Promise<void>;
}

// Only calls an agent (or an unidentified caller) made are recorded: a person
// editing on the canvas who hits a stale version is not an agent mistake.
function isObserved(context: ActionRunContext | undefined): boolean {
  return context?.caller === undefined || isAgentCaller(context);
}

function callerDetails(context: ActionRunContext | undefined) {
  return {
    caller: context?.caller ?? "unknown",
    fromAgent: isAgentCaller(context),
  };
}

interface Refusal {
  errorCode: string;
  statusCode: number;
  details: Record<string, unknown> | undefined;
}

// The same duck type core's `isActionContractError` accepts, read here without
// importing it so the specs' mock of the action module stays small.
function refusalOf(error: unknown): Refusal | null {
  if (typeof error !== "object" || error === null) return null;
  const { actionContractError, errorCode, statusCode, details } =
    error as Record<string, unknown>;
  if (
    actionContractError !== true ||
    typeof errorCode !== "string" ||
    typeof statusCode !== "number" ||
    statusCode < 400 ||
    statusCode >= 500
  ) {
    return null;
  }
  return {
    errorCode,
    statusCode,
    details:
      typeof details === "object" && details !== null
        ? (details as Record<string, unknown>)
        : undefined,
  };
}

function issueDetails(details: Record<string, unknown> | undefined) {
  const issues = details?.issues;
  const count =
    typeof details?.issueCount === "number"
      ? details.issueCount
      : Array.isArray(issues)
        ? issues.length
        : undefined;
  if (!Array.isArray(issues)) {
    return count === undefined ? {} : { issueCount: count };
  }
  const codes = issues
    .slice(0, ISSUE_CODES_RECORDED)
    .map((issue) =>
      typeof (issue as { code?: unknown } | null)?.code === "string"
        ? (issue as { code: string }).code
        : "unknown",
    );
  return {
    ...(count === undefined ? {} : { issueCount: count }),
    // A list is stored as its shape only, so the codes are one string.
    issueCodes: codes.join(","),
  };
}

// Which nodes arrived with nothing in them is the first thing to know about a
// graph that every check refused.
function graphDetails(graph: unknown) {
  const nodes =
    typeof graph === "object" && graph !== null
      ? (graph as { nodes?: unknown }).nodes
      : undefined;
  return {
    graphShape: describeShape(graph),
    ...(Array.isArray(nodes)
      ? {
          nodeCount: nodes.length,
          emptyNodeCount: nodes.filter(
            (node) =>
              typeof node !== "object" ||
              node === null ||
              Object.keys(node).length === 0,
          ).length,
          nodeKeyCounts: nodes
            .slice(0, NODE_KEY_COUNTS_RECORDED)
            .map((node) =>
              typeof node === "object" && node !== null
                ? Object.keys(node).length
                : 0,
            )
            .join(","),
        }
      : {}),
  };
}

// What navigation names is a string the user's own session wrote, so it is
// used only for a factory that exists in the organization.
async function openFactory(orgId: string): Promise<{
  factoryId: string;
  source: "navigation" | "default";
}> {
  try {
    const navigation = await readAppStateForCurrentTab("navigation");
    const parsed = factoryIdSchema.safeParse(
      (navigation as { factoryId?: unknown } | null)?.factoryId,
    );
    if (
      parsed.success &&
      (parsed.data === DEFAULT_FACTORY_ID ||
        (await readFactoryDefinition(orgId, parsed.data)))
    ) {
      return { factoryId: parsed.data, source: "navigation" };
    }
  } catch (error) {
    console.error(
      "[factory-workflow-tripwires] could not read the open factory from navigation:",
      error,
    );
  }
  return { factoryId: DEFAULT_FACTORY_ID, source: "default" };
}

function observeAgentCall(call: ObservedAgentCall): AgentCallWatch {
  const startedAt = Date.now();
  let verifiedOrgId: string | undefined;

  return {
    inOrg(resolved) {
      verifiedOrgId = resolved;
    },

    rejected(error) {
      const refusal = refusalOf(error);
      // A call with no factory is a read of the catalog: nothing was written to refuse.
      if (
        !refusal ||
        call.factoryId === undefined ||
        !isObserved(call.context)
      ) {
        return;
      }
      if (!verifiedOrgId) {
        // Refused before the factory was verified for this caller, so the
        // factory id is theirs to invent: the function log keeps the refusal,
        // the table does not.
        console.error(
          `[factory-workflow-tripwires] ${call.action} refused a call (${refusal.errorCode}) before its organization and factory were verified; not recorded.`,
        );
        return;
      }
      recordTripwire({
        scope: { orgId: verifiedOrgId, factoryId: call.factoryId },
        area: "agent",
        code: "agent_write_rejected",
        severity: "warn",
        ...(call.workflowId === undefined
          ? {}
          : { workflowId: call.workflowId }),
        details: {
          action: call.action,
          errorCode: refusal.errorCode,
          statusCode: refusal.statusCode,
          ...callerDetails(call.context),
          ...issueDetails(refusal.details),
          inputKeys: Object.keys(call.input).join(","),
          ...(call.graph === undefined ? {} : graphDetails(call.graph)),
        },
      });
    },

    async finished() {
      const durationMs = Date.now() - startedAt;
      if (
        !call.slow ||
        durationMs <= SLOW_TOOL_INFO_MS ||
        !isObserved(call.context)
      ) {
        return;
      }
      if (!verifiedOrgId) {
        console.error(
          `[factory-workflow-tripwires] ${call.action} took ${durationMs} ms before its organization and factory were verified; not recorded.`,
        );
        return;
      }
      const factory =
        call.factoryId === undefined
          ? await openFactory(verifiedOrgId)
          : { factoryId: call.factoryId, source: "input" as const };
      recordTripwire({
        scope: { orgId: verifiedOrgId, factoryId: factory.factoryId },
        area: "agent",
        code: "agent_tool_slow",
        severity: durationMs > SLOW_TOOL_WARN_MS ? "warn" : "info",
        ...(call.workflowId === undefined
          ? {}
          : { workflowId: call.workflowId }),
        details: {
          action: call.action,
          durationMs,
          factorySource: factory.source,
          ...callerDetails(call.context),
        },
      });
    },
  };
}

/**
 * Runs `work`, the body of a workflow action, and records what the agent could
 * not otherwise show anyone: the shape of a write that was refused
 * (`agent_write_rejected`) and a call that took long (`agent_tool_slow`).
 * Neither changes what the call does or returns, and a refusal is rethrown
 * as it was.
 *
 * A call refused before the action runs (arguments that do not parse) never
 * reaches this: core refuses it first and the action sees nothing.
 */
export async function watchAgentCall<T>(
  call: ObservedAgentCall,
  work: (watch: Pick<AgentCallWatch, "inOrg">) => Promise<T>,
): Promise<T> {
  const watch = observeAgentCall(call);
  try {
    return await work(watch);
  } catch (error) {
    watch.rejected(error);
    throw error;
  } finally {
    await watch.finished();
  }
}
