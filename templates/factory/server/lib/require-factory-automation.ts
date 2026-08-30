import type { ActionRunContext } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";

import { getDb } from "../db/index.js";
import {
  inferAutomationSource,
  type FactoryAutomationSource,
} from "./factory-automation-config.js";
import {
  factoryAutomationLeafName,
  readAutomationFactoryId,
  requireExistingFactory,
} from "./factory-scope.js";
import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";

const FACTORY_AUTOMATION_NAMES = {
  builderDispatch: new Set([
    "factory-slack-feedback",
    "factory-sentry-errors",
    "factory-github-issues",
  ]),
  governance: new Set(["factory-pr-governance"]),
  prBabysit: new Set(["factory-pr-babysit"]),
  sourcePolling: new Set(["factory-slack-feedback", "factory-sentry-errors"]),
  githubPolling: new Set([
    "factory-github-issues",
    "factory-pr-governance",
    "factory-pr-babysit",
  ]),
} as const;

export type FactoryAutomationRole = keyof typeof FACTORY_AUTOMATION_NAMES;

function sourceAllowsRole(
  role: FactoryAutomationRole,
  source: FactoryAutomationSource | null,
): boolean {
  if (!source) return false;
  if (role === "sourcePolling")
    return source === "slack" || source === "sentry";
  if (role === "githubPolling") return source === "github";
  if (role === "builderDispatch") {
    return source === "slack" || source === "sentry" || source === "github";
  }
  return source === "github";
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

export async function requireFactoryAutomation(
  context: ActionRunContext | undefined,
  identity: Pick<WorkspaceMemberIdentity, "userEmail" | "orgId">,
  role: FactoryAutomationRole,
  expectedFactoryId?: string,
): Promise<void> {
  if (context?.caller !== "automation") {
    throw new Error("This action is only available to Factory automations.");
  }
  const lineage = context.automation;
  if (!lineage) {
    throw governedAutomationError(role, undefined, "role");
  }
  const leafName = factoryAutomationLeafName(lineage.triggerName);

  const definition = (
    await listAutomationDefinitions(
      {
        userEmail: identity.userEmail,
        orgId: identity.orgId,
        appId: "factory",
      },
      "organization",
    )
  ).find((entry) => entry.resource.id === lineage.triggerId);
  if (
    !definition ||
    definition.name !== lineage.triggerName ||
    definition.meta.domain !== "factory" ||
    definition.meta.orgId !== identity.orgId ||
    definition.meta.runAs !== "creator" ||
    !definition.meta.createdBy?.trim()
  ) {
    throw governedAutomationError(role, lineage.triggerName, "definition");
  }
  const source = inferAutomationSource(
    definition.name,
    definition.resource.content,
  );
  if (
    !FACTORY_AUTOMATION_NAMES[role].has(leafName) &&
    !sourceAllowsRole(role, source)
  ) {
    throw governedAutomationError(role, lineage.triggerName, "role");
  }
  if (
    expectedFactoryId &&
    readAutomationFactoryId(
      definition.meta,
      definition.resource.content,
      definition.resource.path,
    ) !== expectedFactoryId
  ) {
    throw governedAutomationError(role, lineage.triggerName, "factory");
  }
  if (expectedFactoryId) {
    await requireExistingFactory(getDb(), identity.orgId, expectedFactoryId);
  }
}
