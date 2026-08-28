import type { ActionRunContext } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";

import { getDb } from "../db/index.js";
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
  // Separate from sourcePolling so PR babysit/governance can refresh GitHub
  // without inheriting Slack or Sentry poll access.
  githubPolling: new Set([
    "factory-github-issues",
    "factory-pr-governance",
    "factory-pr-babysit",
  ]),
} as const;

export type FactoryAutomationRole = keyof typeof FACTORY_AUTOMATION_NAMES;

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
  const expectedNames = FACTORY_AUTOMATION_NAMES[role];
  if (
    !lineage ||
    !expectedNames.has(factoryAutomationLeafName(lineage.triggerName))
  ) {
    throw governedAutomationError(role, lineage?.triggerName, "role");
  }

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
