import type { ActionRunContext } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";

import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";

const FACTORY_AUTOMATION_NAMES = {
  builderDispatch: new Set([
    "factory-slack-feedback",
    "factory-sentry-errors",
    "factory-github-issues",
  ]),
  governance: new Set(["factory-pr-governance"]),
  prBabysit: new Set(["factory-pr-babysit"]),
  sourcePolling: new Set([
    "factory-slack-feedback",
    "factory-sentry-errors",
    "factory-github-issues",
    "factory-pr-governance",
  ]),
} as const;

export type FactoryAutomationRole = keyof typeof FACTORY_AUTOMATION_NAMES;

function workspaceOwnerEmail(): string | undefined {
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase(); // guard:allow-env-credential - deployment owner identity, not a user credential
  if (!email || /[\r\n]/.test(email)) return undefined;
  return email;
}

export async function requireFactoryAutomation(
  context: ActionRunContext | undefined,
  identity: Pick<WorkspaceMemberIdentity, "userEmail" | "orgId">,
  role: FactoryAutomationRole,
): Promise<void> {
  if (context?.caller !== "automation") {
    throw new Error("This action is only available to Factory automations.");
  }
  const lineage = context.automation;
  const expectedNames = FACTORY_AUTOMATION_NAMES[role];
  if (!lineage || !expectedNames.has(lineage.triggerName)) {
    throw new Error(
      "The action was not invoked by a governed Factory automation.",
    );
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
  const ownerEmail = workspaceOwnerEmail();
  if (
    !definition ||
    definition.name !== lineage.triggerName ||
    definition.meta.domain !== "factory" ||
    definition.meta.orgId !== identity.orgId ||
    definition.meta.runAs !== "creator" ||
    !ownerEmail ||
    definition.meta.createdBy?.trim().toLowerCase() !== ownerEmail
  ) {
    throw new Error(
      "The action was not invoked by a governed Factory automation.",
    );
  }
}
