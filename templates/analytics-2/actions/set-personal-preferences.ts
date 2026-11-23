import { defineAction } from "@agent-native/core/action";

import {
  personalPreferencesResult,
  personalPreferencesUpdate,
} from "../shared/personal-preferences.js";
import { savePersonalPreferences } from "./_personal-preferences.js";
export default defineAction({
  description:
    "Save the signed-in person's preferences used by the agent without overwriting a newer edit.",
  schema: personalPreferencesUpdate,
  outputSchema: personalPreferencesResult,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: savePersonalPreferences,
});
