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
import {
  listWorkspaceApps,
  startWorkspaceAppCreation,
} from "../server/lib/app-creation-store.js";
import callAppAction from "./call_app_action.js";

const receiptSchema = z.discriminatedUnion("outcome", [
  z.object({
    suggestionId: z.string(),
    status: z.literal("accepted"),
    outcome: z.literal("action-completed"),
    url: z.string().url().optional(),
  }),
  z.object({
    suggestionId: z.string(),
    status: z.literal("accepted"),
    outcome: z.enum(["app-creation-started", "customization-started"]),
    url: z.string().url(),
  }),
  z.object({
    suggestionId: z.string(),
    status: z.literal("handoff"),
    outcome: z.literal("open-creation-workspace"),
    url: z.string().url(),
  }),
  z.object({
    suggestionId: z.string(),
    status: z.literal("handoff"),
    outcome: z.literal("local-app-creation"),
    prompt: z.string(),
  }),
]);

function targetAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { errorCode?: unknown }).errorCode === "already_exists"
  );
}

function safeAppUrl(value: string | null | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.username || url.password) return undefined;
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return url.protocol === "https:" || local ? url.href : undefined;
}

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
  outputSchema: receiptSchema,
  maxBodyBytes: 65_536,
  uiOnly: true,
  requiresAuth: true,
  requiresSignedInBrowser: true,
  agentTool: false,
  mcpTool: false,
  run: async (
    { suggestion },
    context,
  ): Promise<z.output<typeof receiptSchema>> => {
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
      try {
        await callAppAction.run(
          { app: appId, action: execution.action, args: execution.params },
          context,
        );
      } catch (error) {
        if (!targetAlreadyExists(error)) throw error;
      }
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
      case "app-id-taken": {
        const app = (
          await listWorkspaceApps({ includeAgentCards: false })
        ).find(
          (item) =>
            item.id === result.appId && !item.archived && !item.isDispatch,
        );
        const url = safeAppUrl(app?.url);
        if (!app || !url) return unavailable();
        if (result.conflict === "registered" && app.status === "ready") {
          return {
            suggestionId,
            status: "accepted",
            outcome: "action-completed",
            url,
          };
        }
        if (result.conflict === "pending" && app.status === "pending") {
          return {
            suggestionId,
            status: "accepted",
            outcome: "app-creation-started",
            url,
          };
        }
        return unavailable();
      }
      case "builder-unavailable":
      case "coming-soon":
        return unavailable();
    }
  },
});
