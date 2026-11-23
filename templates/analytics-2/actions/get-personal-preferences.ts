import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { personalPreferencesResult } from "../shared/personal-preferences.js";
import { readPersonalPreferences } from "./_personal-preferences.js";
export default defineAction({
  description: "Read the signed-in person's preferences used by the agent.",
  schema: z.object({}),
  outputSchema: personalPreferencesResult,
  readOnly: true,
  http: { method: "GET" },
  run: readPersonalPreferences,
});
