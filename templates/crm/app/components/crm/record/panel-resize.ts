import {
  RECORD_MAIN_MIN_WIDTH,
  RECORD_PANEL_MIN_WIDTH,
} from "../shared/ui-tokens";

export const DEFAULT_RECORD_PANEL_PERCENT = 32;

const MAX_PANEL_PERCENT = 60;

const STORAGE_KEY = "crm.record.panel-percent";

export function clampPanelPercent(
  percent: number,
  containerWidth: number,
): number {
  if (!Number.isFinite(percent)) return DEFAULT_RECORD_PANEL_PERCENT;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0)
    return DEFAULT_RECORD_PANEL_PERCENT;
  const min = (RECORD_PANEL_MIN_WIDTH / containerWidth) * 100;
  const max = Math.min(
    MAX_PANEL_PERCENT,
    ((containerWidth - RECORD_MAIN_MIN_WIDTH) / containerWidth) * 100,
  );
  if (max <= min) return Math.max(0, Math.min(100, max));
  return Math.min(max, Math.max(min, percent));
}

export function readPanelPercent(): number {
  if (typeof localStorage === "undefined") return DEFAULT_RECORD_PANEL_PERCENT;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0
      ? stored
      : DEFAULT_RECORD_PANEL_PERCENT;
  } catch {
    return DEFAULT_RECORD_PANEL_PERCENT;
  }
}

export function writePanelPercent(percent: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, String(percent));
  } catch {
    // A full or blocked localStorage costs the user a remembered width, which
    // is not worth interrupting a drag over.
  }
}
