export const FORM_BUILDER_TABS = [
  "edit",
  "responses",
  "settings",
  "integrations",
] as const;

export type FormBuilderTab = (typeof FORM_BUILDER_TABS)[number];

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
