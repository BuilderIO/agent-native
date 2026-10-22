import { PANEL_HEIGHT_UNIT_PX } from "@/pages/adhoc/sql-dashboard/types";

const STORAGE_PREFIX = "analytics-extension-panel-height:";

/**
 * How tall an extension panel is before its iframe reports a height: the
 * height it last reported in this browser, so a reload doesn't jump, else one
 * panel height unit.
 */
export function initialExtensionPanelHeight(key: string): number {
  if (typeof window === "undefined") return PANEL_HEIGHT_UNIT_PX;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_PREFIX + key));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // coercion-ok: localStorage is optional; the panel starts one unit tall.
  }
  return PANEL_HEIGHT_UNIT_PX;
}

export function rememberExtensionPanelHeight(key: string, height: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(height));
  } catch {
    // coercion-ok: localStorage is optional; the next load starts one unit tall.
  }
}
