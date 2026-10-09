import type {
  EvalProductionContext,
  EvalProductionIdentity,
} from "@agent-native/core/eval";
import {
  attachToolSearch,
  buildFrameworkPrompts,
  generateActionsPrompt,
  loadActionsFromStaticRegistry,
  TOOL_SEARCH_ACTION_NAME,
} from "@agent-native/core/server";

import actionsRegistry from "../.generated/actions-registry.js";
import {
  INITIAL_TOOL_NAMES,
  analyticsExtraContext,
  realDataFinalGuard,
} from "../server/plugins/agent-chat.js";

const REQUIRED_ANALYTICS_QUERY_ACTIONS = [
  "find-data",
  "bigquery",
  "search-bigquery-schema",
] as const;

/**
 * Reuses Analytics rules, guard, and static read-only actions. This context
 * cannot invoke the mounted chat handler: its request preparation and dynamic
 * prompt/tool assembly are closure-local to the chat plugin. It intentionally
 * omits productionChatPath so the eval runner rejects production claims until
 * that handler exposes a safe test seam. Identity is always caller-supplied.
 */
export function resolveProductionEvalContext(
  identity: EvalProductionIdentity,
): EvalProductionContext {
  const ownerEmail = identity.ownerEmail.trim();
  const orgId = identity.orgId.trim();
  if (!ownerEmail || !orgId) {
    throw new Error(
      "Analytics evals require a non-empty owner email and organization id.",
    );
  }

  const actions = Object.fromEntries(
    Object.entries(loadActionsFromStaticRegistry(actionsRegistry)).filter(
      ([, action]) =>
        action.readOnly === true &&
        action.agentTool !== false &&
        action.uiOnly !== true,
    ),
  );
  for (const actionName of REQUIRED_ANALYTICS_QUERY_ACTIONS) {
    if (!actions[actionName]) {
      throw new Error(
        `Analytics production eval action registry is missing read-only action "${actionName}".`,
      );
    }
  }
  attachToolSearch(actions);

  const initialToolNames = [
    ...new Set([...INITIAL_TOOL_NAMES, TOOL_SEARCH_ACTION_NAME]),
  ].filter((name) => Boolean(actions[name]));
  const frameworkPrompt = buildFrameworkPrompts(undefined, {
    extensions: true,
  }).PROD_FRAMEWORK_PROMPT_COMPACT;
  const systemPrompt = [
    frameworkPrompt,
    generateActionsPrompt(actions, "tool", initialToolNames),
    analyticsExtraContext(),
    "This eval uses the production Analytics read-only action surface. Do not create, edit, send, publish, or persist app data.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    actions,
    systemPrompt,
    finalResponseGuard: realDataFinalGuard,
    ownerEmail,
    orgId,
    appId: "analytics",
    initialToolNames,
  };
}
