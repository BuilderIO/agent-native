import type { ActionSuggestionReceipt } from "@agent-native/agentkit/protocol";
import {
  defineAction,
  noteExternalWrite,
  NoWriteError,
} from "@agent-native/core/action";
import { runBuilderAgent } from "@agent-native/core/server";
import { z } from "zod";

import {
  actionSuggestionSchema,
  canOfferActionSuggestion,
  resolveCustomizationTarget,
} from "../server/lib/action-suggestions.js";
import { startWorkspaceAppCreation } from "../server/lib/app-creation-store.js";
import callAppAction from "./call_app_action.js";

function unavailable(): never {
  throw new NoWriteError(
    "This suggestion is no longer available in this workspace.",
    {
      errorCode: "action_suggestion_unavailable",
      statusCode: 409,
    },
  );
}

export default defineAction({
  description:
    "Execute the typed action the signed-in user selected in the chat.",
  schema: z.object({ suggestion: actionSuggestionSchema }),
  maxBodyBytes: 65_536,
  uiOnly: true,
  requiresAuth: true,
  requiresSignedInBrowser: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ suggestion }, context): Promise<ActionSuggestionReceipt> => {
    const { id: suggestionId, appId, execution } = suggestion;
    if (execution.type === "customize") {
      const target = await resolveCustomizationTarget(execution.targetAppId);
      if (!target) unavailable();
      noteExternalWrite("app-customization");
      const result = await runBuilderAgent({
        projectId: target.builderProjectId,
        userEmail: target.userEmail,
        prompt: `Update only the existing workspace app apps/${target.appId}.\n\n${execution.editSpec}`,
      });
      return {
        suggestionId,
        status: "accepted",
        outcome: "customization-started",
        url: result.url,
      };
    }

    if (!(await canOfferActionSuggestion(suggestion))) unavailable();
    if (execution.type === "action") {
      await callAppAction.run(
        { app: appId, action: execution.action, args: execution.params },
        context,
      );
      return { suggestionId, status: "accepted", outcome: "action-completed" };
    }

    const result = await startWorkspaceAppCreation({
      prompt: execution.domainSpec,
    });
    switch (result.mode) {
      case "builder":
        return {
          suggestionId,
          status: "accepted",
          outcome: "app-creation-started",
          url: result.url,
        };
      case "builder-managed":
        return {
          suggestionId,
          status: "handoff",
          outcome: "open-creation-workspace",
          url: result.url,
        };
      case "local-agent":
        return {
          suggestionId,
          status: "handoff",
          outcome: "local-app-creation",
          prompt: result.prompt,
        };
      default:
        return unavailable();
    }
  },
});
