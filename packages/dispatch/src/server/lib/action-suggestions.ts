import {
  ACTION_SUGGESTION_KINDS,
  ACTION_SUGGESTION_TRIGGERS,
  parseActionSuggestion,
  type ActionSuggestion,
} from "@agent-native/agentkit/protocol";
import {
  getBuilderWorkspaceUrl,
  getRequestOrgId,
  getRequestUserEmail,
  readOrgMemberRole,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  hasUnselectedDestructiveVariant,
  isUnsupportedSuggestedAction,
  NEW_APP_SUGGESTION_APP_ID,
} from "../../lib/action-suggestions.js";
import {
  getAppCreationSettings,
  isLocalAppCreationRuntime,
  listWorkspaceApps,
} from "./app-creation-store.js";
import {
  listGrantedDispatchMcpAppActions,
  resolveGrantedDispatchMcpApp,
} from "./mcp-gateway.js";

const appId = z.string().trim().min(1).max(256);

export const actionSuggestionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    kind: z.enum(ACTION_SUGGESTION_KINDS),
    trigger: z.enum(ACTION_SUGGESTION_TRIGGERS),
    label: z.string().trim().min(1).max(96),
    rationale: z.string().trim().min(1).max(280),
    appId,
    execution: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("action"),
        action: z.string().trim().min(1).max(128),
        params: z.record(z.string(), z.unknown()),
      }),
      z.object({
        type: z.literal("customize"),
        targetAppId: appId,
        editSpec: z.string().trim().min(1).max(4_000),
      }),
      z.object({
        type: z.literal("create-app"),
        domainSpec: z.string().trim().min(1).max(4_000),
      }),
    ]),
  })
  .superRefine((value, context) => {
    try {
      parseActionSuggestion(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid suggestion",
      });
    }
  });

export async function resolveCustomizationTarget(targetAppId: string) {
  const orgId = getRequestOrgId();
  const userEmail = getRequestUserEmail();
  if (!orgId || !userEmail) return null;
  const role = await readOrgMemberRole(orgId, userEmail);
  if (role !== "owner" && role !== "admin") return null;

  const app = await resolveGrantedDispatchMcpApp(targetAppId);
  if (app.id !== targetAppId) return null;
  const apps = await listWorkspaceApps();
  const mounted = apps.find(
    (item) =>
      (item.id === app.id || `${orgId}/${item.id}` === app.id) &&
      !item.archived &&
      !item.isDispatch &&
      item.status !== "pending",
  );
  if (!mounted?.url || new URL(mounted.url).origin !== new URL(app.url).origin)
    return null;
  const { builderProjectId } = await getAppCreationSettings();
  return builderProjectId
    ? { appId: mounted.id, builderProjectId, userEmail }
    : null;
}

export async function canOfferActionSuggestion(suggestion: ActionSuggestion) {
  const { appId, execution } = suggestion;
  switch (execution.type) {
    case "action": {
      if (isUnsupportedSuggestedAction(execution)) return false;
      const app = await resolveGrantedDispatchMcpApp(appId);
      if (app.id !== appId) return false;
      const actions = await listGrantedDispatchMcpAppActions(app.id, [
        execution.action,
      ]);
      return actions.some(
        (action) =>
          action.name === execution.action &&
          action.readOnly !== true &&
          action.destructive !== true &&
          !hasUnselectedDestructiveVariant(execution, action.inputSchema),
      );
    }
    case "customize":
      return (await resolveCustomizationTarget(execution.targetAppId)) !== null;
    case "create-app":
      if (appId !== NEW_APP_SUGGESTION_APP_ID || !getRequestOrgId())
        return false;
      return Boolean(
        isLocalAppCreationRuntime() ||
        getBuilderWorkspaceUrl() ||
        (await getAppCreationSettings()).builderBranchingEnabled,
      );
  }
}
