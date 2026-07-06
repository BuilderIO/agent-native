export type ResourceVisibility = "private" | "org" | "public";

export function ownerDisplayName(ownerEmail?: string | null): string | null {
  const trimmed = ownerEmail?.trim();
  if (!trimmed) return null;
  const [localPart] = trimmed.split("@");
  return localPart || trimmed;
}

export function visibilityLabelKey(visibility: ResourceVisibility): string {
  if (visibility === "public") return "sidebar.visibilityPublic";
  if (visibility === "org") return "sidebar.visibilityOrg";
  return "sidebar.visibilityPrivate";
}
