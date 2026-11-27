import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { contentFormSettingsSchema } from "../shared/content-forms.js";
import { getContentFormSettings } from "./_content-forms.js";

export default defineAction({
  description:
    "Read the settings and link of the form behind one Form view of a Content collection: who may answer, whether it is accepting answers, one answer per person, the thank-you message and the form's page. configured is false and link is null until configure-content-form first sets it up. Needs edit access to the collection.",
  schema: z.object({
    databaseId: z.string().min(1).describe("Content collection ID"),
    viewId: z.string().min(1).describe("The collection's Form view ID"),
  }),
  outputSchema: contentFormSettingsSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: async (args) => getContentFormSettings(args),
});
