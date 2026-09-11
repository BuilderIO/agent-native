export type DashboardVisibility = "private" | "org" | "public";
export type DashboardVisibilityFilter = "all" | "private" | "shared";

export type DashboardVisibilityItem = {
  visibility?: DashboardVisibility;
  ownerEmail?: string | null;
};

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function isDashboardMine(
  item: DashboardVisibilityItem,
  currentUserEmail?: string | null,
): boolean {
  if (item.visibility === "org" || item.visibility === "public") {
    return false;
  }

  if ("ownerEmail" in item) {
    const ownerEmail = normalizeEmail(item.ownerEmail);
    const viewerEmail = normalizeEmail(currentUserEmail);
    return Boolean(ownerEmail && viewerEmail && ownerEmail === viewerEmail);
  }

  // Older dashboard-shaped items do not always carry ownership metadata.
  return true;
}

export function matchesDashboardVisibilityFilter(
  item: DashboardVisibilityItem,
  filter: DashboardVisibilityFilter,
  currentUserEmail?: string | null,
): boolean {
  if (filter === "all") return true;
  return filter === "private"
    ? isDashboardMine(item, currentUserEmail)
    : !isDashboardMine(item, currentUserEmail);
}
