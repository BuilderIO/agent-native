export const FORM_BUILDER_TABS = [
  "edit",
  "responses",
  "settings",
  "integrations",
] as const;

export type FormBuilderTab = (typeof FORM_BUILDER_TABS)[number];

export const FORMS_NAVIGATION_VIEWS = [
  "ask",
  "home",
  "forms",
  "form",
  "responses",
  "response-insights",
  "team",
  "extensions",
  "form-preview",
] as const;

export type FormsNavigationView = (typeof FORMS_NAVIGATION_VIEWS)[number];

export interface FormsNavigationTarget {
  view?: FormsNavigationView | string | null;
  formId?: string | null;
  tab?: string | null;
  activeTab?: string | null;
}

const FORM_BUILDER_TAB_SET = new Set<string>(FORM_BUILDER_TABS);

export function normalizeFormBuilderTab(
  value: string | null | undefined,
): FormBuilderTab {
  if (value === "results") return "responses";
  if (value && FORM_BUILDER_TAB_SET.has(value)) {
    return value as FormBuilderTab;
  }
  return "edit";
}

export function formBuilderTabSearchParam(tab: FormBuilderTab): string {
  return tab;
}

export function formBuilderPath(
  formId: string,
  tab: string | null | undefined = "edit",
): string {
  const normalizedTab = normalizeFormBuilderTab(tab);
  return `/forms/${encodeURIComponent(formId)}?tab=${formBuilderTabSearchParam(normalizedTab)}`;
}

export function formsRoutePath(target: FormsNavigationTarget): string | null {
  const formId = target.formId ?? undefined;
  const tab = target.tab ?? target.activeTab;

  if (!target.view && formId) return formBuilderPath(formId, tab);

  switch (target.view) {
    case "ask":
    case "home":
      return "/ask";
    case "forms":
      return "/forms";
    case "form":
      return formId ? formBuilderPath(formId, tab) : null;
    case "responses":
      return formId ? `/forms/${encodeURIComponent(formId)}/responses` : null;
    case "response-insights":
      return formId
        ? `/response-insights?formId=${encodeURIComponent(formId)}`
        : "/response-insights";
    case "team":
      return "/settings#organization";
    case "extensions":
      return "/extensions";
    case "form-preview":
      return "/form-preview";
    default:
      return null;
  }
}
