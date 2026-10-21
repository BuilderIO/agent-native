import type { ActionRunContext } from "@agent-native/core/action";

import { getDb } from "../db/index.js";
import { graphNamesAction } from "../workflow-host/operation-gate.js";
import {
  canonicalSeedLeafName,
  inferAutomationSource,
  readFrontmatterValue,
  type FactoryAutomationSource,
} from "./factory-automation-config.js";
import {
  factoryIdFromAutomationName,
  findFactoryAutomationDefinition,
  type FactoryAutomationDefinition,
} from "./factory-automation-resources.js";
import {
  factoryAutomationLeafName,
  readAutomationFactoryId,
  requireExistingFactory,
} from "./factory-scope.js";
import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";
import { failWorkflowAction } from "./workflow-action-errors.js";
import { actionTripwire } from "./workflow-run-observer.js";

type FactoryAutomationRole =
  | "governance"
  | "sourcePolling"
  | "githubPolling"
  | "workflow";

// Seeded job names admitted by name. Any other agent job is admitted by the
// source its config implies; a workflow job by its saved graph, never by name.
const SEEDED_JOB_NAMES: Partial<
  Record<FactoryAutomationRole, ReadonlySet<string>>
> = {
  governance: new Set(["factory-pr-governance"]),
  githubPolling: new Set(["factory-pr-governance"]),
};

function sourceAllowsRole(
  role: FactoryAutomationRole,
  source: FactoryAutomationSource | null,
): boolean {
  if (!source || role === "workflow") return false;
  if (role === "sourcePolling")
    return source === "slack" || source === "sentry";
  return source === "github";
}

function leafMatchesGovernedName(
  leafName: string,
  names: ReadonlySet<string> | undefined,
): boolean {
  if (!names) return false;
  if (names.has(leafName)) return true;
  const canonical = canonicalSeedLeafName(leafName);
  return canonical != null && names.has(canonical);
}

function governedAutomationError(
  role: FactoryAutomationRole,
  triggerName: string | undefined,
  reason: "role" | "definition" | "factory",
): Error {
  const name = triggerName?.trim();
  if (!name) {
    return new Error(
      `The action was not invoked by a governed Factory automation (${role}).`,
    );
  }
  if (reason === "role") {
    return new Error(`${name} is not allowed to call this action (${role}).`);
  }
  if (reason === "factory") {
    return new Error(
      `${name} is not the governed Factory automation for this factory (${role}).`,
    );
  }
  return new Error(`${name} is not a governed Factory automation (${role}).`);
}

/**
 * Whether the saved job file says its runner is the workflow engine. Both
 * parsers are asked: the job file is read as a whole by core and by line here,
 * and either one seeing the runner must send the job down the graph path.
 */
function isWorkflowJob(
  definition: Pick<FactoryAutomationDefinition, "meta" | "resource">,
): boolean {
  return (
    definition.meta.runner === "workflow" ||
    isWorkflowJobContent(definition.resource.content)
  );
}

export function isWorkflowJobContent(content: string): boolean {
  return readFrontmatterValue(content, "runner") === "workflow";
}

/** A call refused before the graph is read: the job's definition or factory does not match; observe only. */
function reportDenied(
  orgId: string,
  factoryId: string,
  reason: string,
  facts: Record<string, unknown>,
): void {
  actionTripwire({ orgId, factoryId })({
    area: "gate",
    code: "operation_gate_denied",
    severity: "warn",
    details: { reason, ...facts },
  });
}

export async function requireFactoryAutomation(
  context: ActionRunContext | undefined,
  identity: Pick<WorkspaceMemberIdentity, "userEmail" | "orgId">,
  role: FactoryAutomationRole,
  expectedFactoryId?: string,
  options: { operationId?: string } = {},
): Promise<void> {
  if (context?.caller !== "automation") {
    throw new Error("This action is only available to Factory automations.");
  }
  const lineage = context.automation;
  if (!lineage) {
    throw governedAutomationError(role, undefined, "role");
  }
  const leafName = factoryAutomationLeafName(lineage.triggerName);

  const factoryId =
    expectedFactoryId ?? factoryIdFromAutomationName(lineage.triggerName);
  const definition = factoryId
    ? await findFactoryAutomationDefinition(
        identity.orgId,
        factoryId,
        lineage.triggerId,
      )
    : null;
  if (
    !factoryId ||
    !definition ||
    definition.name !== lineage.triggerName ||
    (definition.meta.orgId != null &&
      definition.meta.orgId !== identity.orgId) ||
    (definition.meta.runAs != null && definition.meta.runAs !== "creator") ||
    !definition.meta.createdBy?.trim()
  ) {
    if (factoryId) {
      reportDenied(identity.orgId, factoryId, "definition_mismatch", {
        found: definition !== null,
        nameMatches: definition?.name === lineage.triggerName,
        runAsCreator: (definition?.meta.runAs ?? "creator") === "creator",
        hasCreator: Boolean(definition?.meta.createdBy?.trim()),
      });
    }
    throw governedAutomationError(role, lineage.triggerName, "definition");
  }
  const assertSameFactory = () => {
    if (
      expectedFactoryId &&
      readAutomationFactoryId(
        definition.meta,
        definition.resource.content,
        definition.resource.path,
      ) !== expectedFactoryId
    ) {
      reportDenied(identity.orgId, expectedFactoryId, "factory_mismatch", {});
      throw governedAutomationError(role, lineage.triggerName, "factory");
    }
  };
  if (isWorkflowJob(definition)) {
    assertSameFactory();
    const allowed = await graphNamesAction({
      orgId: identity.orgId,
      factoryId,
      automationId: lineage.triggerId,
      actionName: context.actionName,
      operationId: options.operationId,
    });
    if (!allowed) {
      failWorkflowAction({
        message: `${lineage.triggerName} is a workflow job and its saved graph does not name ${context.actionName ?? "this action"}${options.operationId ? ` for ${options.operationId}` : ""}.`,
        errorCode: "workflow_action_not_allowed",
        statusCode: 403,
        details: {
          actionName: context.actionName ?? null,
          operationId: options.operationId ?? null,
        },
      });
    }
  } else {
    const source = inferAutomationSource(
      definition.name,
      definition.resource.content,
    );
    if (
      !leafMatchesGovernedName(leafName, SEEDED_JOB_NAMES[role]) &&
      !sourceAllowsRole(role, source)
    ) {
      throw governedAutomationError(role, lineage.triggerName, "role");
    }
    assertSameFactory();
  }
  if (expectedFactoryId) {
    await requireExistingFactory(getDb(), identity.orgId, expectedFactoryId);
  }
}
