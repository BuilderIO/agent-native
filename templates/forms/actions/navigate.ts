import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a view or form. Views: forms, form, responses, settings.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe("View to navigate to (forms, form, responses, settings)"),
    formId: z
      .string()
      .optional()
      .describe("Form to open (for form or responses view)"),
  }),
  http: false,
  run: async (args) => {
    const { view, formId } = args;

    if (!view && !formId) {
      return "Error: At least --view or --formId is required.";
    }

    const nav: Record<string, string> = {};
    if (view) nav.view = view;
    if (formId) nav.formId = formId;

    await writeAppState("navigate", nav);
    return `Navigating to ${view || "form"}${formId ? ` (form: ${formId})` : ""}`;
  },
});
