import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
} from "./_tab-state.js";

interface NavigationState {
  formId?: string;
}

function writeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default defineAction({
  description:
    "Navigate the UI to a view or form. Views: home, forms, form, responses, response-insights, team, extensions, form-preview. Use view=responses with a formId when the user asks to see/open all responses for a form. Use view=form with tab=edit|responses|settings|integrations to open a form builder sub-tab.",
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
        "Form to open (for form, responses, or response-insights view). For form/responses, omitted formId falls back to the current form when one is active.",
      ),
    tab: z
      .enum(["edit", "responses", "settings", "integrations"])
      .optional()
      .describe(
        "Form builder sub-tab to open when view is form: edit, responses, settings, or integrations. If omitted with a current form, the current form is used.",
      ),
  }),
  http: false,
  run: async (args) => {
    const { view, formId, tab } = args;
    const resolvedView = view ?? (formId || tab ? "form" : undefined);
    const currentNavigation = (await readAppStateForCurrentTab("navigation", {
      fallbackToGlobal: false,
    })) as NavigationState | null;
    const resolvedFormId =
      formId ??
      (resolvedView === "form" || resolvedView === "responses"
        ? currentNavigation?.formId
        : undefined);

    if (!view && !formId && !tab) {
      throw new Error("At least --view, --formId, or --tab is required.");
    }
    if (tab && resolvedView !== "form") {
      throw new Error("--tab can only be used with --view form.");
    }
    if (
      (resolvedView === "form" || resolvedView === "responses") &&
      !resolvedFormId
    ) {
      throw new Error(`${resolvedView} navigation requires a formId.`);
    }

    const nav: Record<string, string> = {};
    if (resolvedView) nav.view = resolvedView;
    if (resolvedFormId) nav.formId = resolvedFormId;
    if (tab) nav.tab = tab;
    nav._writeId = writeId();

    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${resolvedView || "form"}${resolvedFormId ? ` (form: ${resolvedFormId})` : ""}${tab ? ` tab: ${tab}` : ""}`;
  },
});
