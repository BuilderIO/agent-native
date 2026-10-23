import { PANEL_HEIGHT_UNIT_PX } from "@/pages/adhoc/sql-dashboard/types";

const STORAGE_PREFIX = "analytics-extension-panel-height:";

/**
 * The most a remembered height can hold open before the iframe reports,
 * several times the tallest real extension panels (about 600-850px), so a
 * runaway report can't reserve an empty page on the next visit.
 */
export const MAX_REMEMBERED_EXTENSION_PANEL_HEIGHT = 4000;

/** Where a panel's height is remembered: per dashboard, panel and extension. */
export function extensionPanelHeightKey(
  dashboardId: string | undefined,
  panelId: string,
  extensionId: string | undefined,
): string {
  return `${dashboardId ?? ""}:${panelId}:${extensionId ?? ""}`;
}

/**
 * How tall an extension panel is before its iframe reports a height: the
 * height it last reported in this browser, so a reload doesn't jump, else one
 * panel height unit.
 */
export function initialExtensionPanelHeight(key: string): number {
  if (typeof window === "undefined") return PANEL_HEIGHT_UNIT_PX;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_PREFIX + key));
    if (Number.isFinite(stored) && stored > 0) {
      return Math.min(stored, MAX_REMEMBERED_EXTENSION_PANEL_HEIGHT);
    }
  } catch {
    // coercion-ok: localStorage is optional; the panel starts one unit tall.
  }
  return PANEL_HEIGHT_UNIT_PX;
}

export function rememberExtensionPanelHeight(key: string, height: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      String(Math.min(height, MAX_REMEMBERED_EXTENSION_PANEL_HEIGHT)),
    );
  } catch {
    // coercion-ok: localStorage is optional; the next load starts one unit tall.
  }
}
