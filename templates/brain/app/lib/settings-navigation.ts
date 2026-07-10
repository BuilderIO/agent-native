export function createSettingsSectionIds(
  appSectionIds: Iterable<string>,
): Set<string> {
  return new Set(["general", "team", "whats-new", ...appSectionIds]);
}

export function resolveSettingsSection(
  section: string | null,
  validSections: ReadonlySet<string>,
): string {
  return section && validSections.has(section) ? section : "general";
}

export function withSettingsSection(
  search: URLSearchParams,
  section: string,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (section === "general") next.delete("section");
  else next.set("section", section);
  return next;
}
