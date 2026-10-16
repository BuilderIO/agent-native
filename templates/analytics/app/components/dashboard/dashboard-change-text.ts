import type { DashboardChange } from "@shared/dashboard-change-summary";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function dashboardChangeText(
  change: DashboardChange,
  t: Translate,
): string {
  const panel = (title: string | null) =>
    title ?? t("dashboardChanges.untitledPanel");
  switch (change.kind) {
    case "version-restored":
      return t("dashboardChanges.versionRestored");
    case "dashboard-renamed":
      return t("dashboardChanges.dashboardRenamed", { to: change.to });
    case "description-changed":
      return t("dashboardChanges.descriptionChanged");
    case "panel-added":
      return change.title
        ? t("dashboardChanges.panelAdded", { title: change.title })
        : t("dashboardChanges.panelAddedUntitled");
    case "panel-removed":
      return change.title
        ? t("dashboardChanges.panelRemoved", { title: change.title })
        : t("dashboardChanges.panelRemovedUntitled");
    case "panel-renamed":
      return t("dashboardChanges.panelRenamed", {
        from: change.from,
        to: change.to,
      });
    case "panel-query-changed":
      return t("dashboardChanges.panelQueryChanged", {
        title: panel(change.title),
      });
    case "panel-display-changed":
      return t("dashboardChanges.panelDisplayChanged", {
        title: panel(change.title),
      });
    case "column-resized": {
      const title = panel(change.title);
      if (change.columns > 1) {
        return t("dashboardChanges.columnsResized", { title });
      }
      if (change.direction === "wider") {
        return t("dashboardChanges.columnWidened", { title });
      }
      if (change.direction === "narrower") {
        return t("dashboardChanges.columnNarrowed", { title });
      }
      return t("dashboardChanges.columnResized", { title });
    }
    case "columns-changed":
      return t("dashboardChanges.columnsChanged", {
        title: panel(change.title),
      });
    case "panel-resized":
      return change.title
        ? t("dashboardChanges.panelResized", { title: change.title })
        : t("dashboardChanges.panelResizedUntitled");
    case "layout-changed":
      return t("dashboardChanges.layoutChanged");
    case "filter-added":
      return t("dashboardChanges.filterAdded", { label: change.label });
    case "filter-removed":
      return t("dashboardChanges.filterRemoved", { label: change.label });
    case "filter-changed":
      return t("dashboardChanges.filterChanged", { label: change.label });
    case "other":
      return t("dashboardChanges.other");
  }
}

/**
 * The first change, worded, plus how many more there are; `omitted` counts
 * changes the stored summary left out.
 */
export function dashboardChangeLine(
  changes: DashboardChange[],
  omitted: number,
  t: Translate,
): { first: string; rest: string[]; moreCount: number } | null {
  if (changes.length === 0) return null;
  const [first, ...rest] = changes.map((change) =>
    dashboardChangeText(change, t),
  );
  return { first, rest, moreCount: rest.length + omitted };
}
