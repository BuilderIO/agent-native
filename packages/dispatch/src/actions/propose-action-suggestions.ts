import {
  MAX_ACTION_SUGGESTIONS_PER_TURN,
  type ActionSuggestionResult,
} from "@agent-native/agentkit/protocol";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { uniqueActionSuggestions } from "../lib/action-suggestions.js";
import {
  actionSuggestionSchema,
  canOfferActionSuggestion,
} from "../server/lib/action-suggestions.js";

export default defineAction({
  description:
    "Offer up to two concrete, optional next actions in the current chat turn. Use only work that would benefit the user and that the user has not already asked you to perform. For an app action, use the exact app ID and action name from the granted app catalog and supply its actual inputs. For a persistent workflow that no installed app fits, use kind create-app, trigger new-domain, and appId dispatch. Suggestions take effect only after the user selects one.",
  schema: z.object({
    suggestions: z
      .array(actionSuggestionSchema)
      .max(MAX_ACTION_SUGGESTIONS_PER_TURN),
  }),
  outputSchema: z.object({
    suggestions: z
      .array(actionSuggestionSchema)
      .max(MAX_ACTION_SUGGESTIONS_PER_TURN),
  }),
  readOnly: true,
  http: false,
  mcpTool: false,
  run: async ({ suggestions }): Promise<ActionSuggestionResult> => {
    const candidates = uniqueActionSuggestions(suggestions);
    const available = await Promise.allSettled(
      candidates.map(canOfferActionSuggestion),
    );
    return {
      suggestions: candidates.filter((_, index) => {
        const result = available.at(index);
        return result?.status === "fulfilled" && result.value;
      }),
    };
  },
});
