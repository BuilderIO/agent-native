export function templateLibraryPath(templateId?: string, search?: string) {
  const params = new URLSearchParams();
  if (templateId) params.set("templateId", templateId);
  if (search) params.set("search", search);
  return `/templates${params.size ? `?${params}` : ""}`;
}

export function templateLibraryNavigation(search: string) {
  const params = new URLSearchParams(search);
  return {
    view: "templates",
    templateId: params.get("templateId")?.slice(0, 200) || undefined,
    search: params.get("search")?.slice(0, 200) || undefined,
  };
}
