export type DashboardVisibility = "private" | "org" | "public";
export type DashboardVisibilityFilter = "all" | "private" | "shared";

export type DashboardVisibilityItem = {
  visibility?: DashboardVisibility;
  ownerEmail?: string | null;
  /** Sample content installed for the user; never theirs, never someone else's. */
  demo?: boolean;
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

  return true;
}

// Sidebar "Mine" means "I own it", whether or not I have shared it. The
// Overview's personal/shared scope keeps `isDashboardMine`: it picks folders.
function isOwnedByViewer(
  item: DashboardVisibilityItem,
  currentUserEmail?: string | null,
): boolean {
  if (!("ownerEmail" in item)) return item.visibility === "private";
  const ownerEmail = normalizeEmail(item.ownerEmail);
  const viewerEmail = normalizeEmail(currentUserEmail);
  return Boolean(ownerEmail && viewerEmail && ownerEmail === viewerEmail);
}

export function matchesDashboardVisibilityFilter(
  item: DashboardVisibilityItem,
  filter: DashboardVisibilityFilter,
  currentUserEmail?: string | null,
): boolean {
  if (filter === "all") return true;
  if (item.demo) return false;
  return filter === "private"
    ? isOwnedByViewer(item, currentUserEmail)
    : !isOwnedByViewer(item, currentUserEmail);
}
