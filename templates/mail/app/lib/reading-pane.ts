export const READING_PANE_MIN_VIEWPORT = 1024;
export const READING_PANE_EMAIL_MIN_WIDTH = 600;
export const READING_PANE_LIST_MIN_WIDTH = 320;
export const READING_PANE_LIST_DEFAULT_WIDTH = 340;
export const READING_PANE_SIDE_PANEL_WIDTH = 260;

const LIST_WIDTH_STORAGE_KEY = "mail-reading-pane-list-width";
const ENABLED_STORAGE_KEY = "mail-reading-pane-enabled";

export type ReadingPaneLayout =
  | { mode: "off" }
  | {
      mode: "pane";
      listWidth: number;
      listMinWidth: number;
      listMaxWidth: number;
      showSidePanel: boolean;
    };

export function readingPaneLayout({
  enabled,
  viewportWidth,
  containerWidth,
  preferredListWidth,
}: {
  enabled: boolean;
  viewportWidth: number;
  containerWidth: number;
  preferredListWidth: number | null;
}): ReadingPaneLayout {
  const minimum = READING_PANE_LIST_MIN_WIDTH + READING_PANE_EMAIL_MIN_WIDTH;
  if (
    !enabled ||
    viewportWidth < READING_PANE_MIN_VIEWPORT ||
    containerWidth < minimum
  ) {
    return { mode: "off" };
  }
  const showSidePanel =
    containerWidth >= minimum + READING_PANE_SIDE_PANEL_WIDTH;
  const available =
    containerWidth - (showSidePanel ? READING_PANE_SIDE_PANEL_WIDTH : 0);
  const listMaxWidth = available - READING_PANE_EMAIL_MIN_WIDTH;
  return {
    mode: "pane",
    listWidth: clampListWidth(
      preferredListWidth ?? READING_PANE_LIST_DEFAULT_WIDTH,
      listMaxWidth,
    ),
    listMinWidth: READING_PANE_LIST_MIN_WIDTH,
    listMaxWidth,
    showSidePanel,
  };
}

export function clampListWidth(width: number, maxWidth: number): number {
  return Math.round(
    Math.min(Math.max(width, READING_PANE_LIST_MIN_WIDTH), maxWidth),
  );
}

export function readStoredListWidth(storage: Storage): number | null {
  const raw = storage.getItem(LIST_WIDTH_STORAGE_KEY);
  if (raw === null) return null;
  const width = Number(raw);
  return Number.isFinite(width) && width >= READING_PANE_LIST_MIN_WIDTH
    ? width
    : null;
}

export function storeListWidth(storage: Storage, width: number) {
  storage.setItem(LIST_WIDTH_STORAGE_KEY, String(Math.round(width)));
}

export function readStoredPaneEnabled(storage: Storage): boolean | null {
  const raw = storage.getItem(ENABLED_STORAGE_KEY);
  if (raw === "on") return true;
  if (raw === "off") return false;
  return null;
}

export function storePaneEnabled(storage: Storage, enabled: boolean) {
  storage.setItem(ENABLED_STORAGE_KEY, enabled ? "on" : "off");
}
