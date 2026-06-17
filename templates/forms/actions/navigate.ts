import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a view or form. Views: home, forms, form, responses, response-insights, team, extensions, form-preview.",
  schema: z.object({
    view: z
      .enum([
        "home",
        "forms",
        "form",
        "responses",
        "response-insights",
        "team",
        "extensions",
        "form-preview",
      ])
      .optional()
      .describe(
        "View to navigate to (home, forms, form, responses, response-insights, team, extensions, form-preview)",
      ),
    formId: z
      .string()
      .optional()
      .describe(
        "Form to open (for form, responses, or response-insights view)",
      ),
  }),
  http: false,
  run: async (args) => {
    const { view, formId } = args;
    const resolvedView = view ?? (formId ? "form" : undefined);

    if (!view && !formId) {
      throw new Error("At least --view or --formId is required.");
    }

    const nav: Record<string, string> = {};
    if (resolvedView) nav.view = resolvedView;
    if (formId) nav.formId = formId;

    await writeAppState("navigate", nav);
    return `Navigating to ${resolvedView || "form"}${formId ? ` (form: ${formId})` : ""}`;
  },
});
