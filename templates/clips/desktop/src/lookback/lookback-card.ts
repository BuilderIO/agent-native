import { lookbackLabel } from "../../../shared/screen-history-context";
import type { RecordingContextItem } from "./context-api";

export type LookbackCardLine =
  | { kind: "hidden" }
  | { kind: "unreadable" }
  | { kind: "saving"; window: string }
  | { kind: "ready"; window: string }
  | { kind: "failed" };

// "unreadable" is kept apart from "hidden" so a failed read is never shown as
// a recording that simply has no earlier screen time.
export function lookbackCardLine(view: {
  status: "idle" | "loading" | "loaded" | "error";
  item: RecordingContextItem | null;
}): LookbackCardLine {
  if (view.status === "error") return { kind: "unreadable" };
  const item = view.item;
  if (!item || item.status === "removed") return { kind: "hidden" };
  const window = lookbackLabel(item.requestedSeconds);
  switch (item.status) {
    case "pending":
    case "processing":
      return { kind: "saving", window };
    case "ready":
      return { kind: "ready", window };
    case "failed":
      return { kind: "failed" };
  }
}

// Editing re-exports footage, so it waits until no export is running.
export function canEditLookbackWindow(
  item: RecordingContextItem | null,
): boolean {
  return item?.status === "ready" || item?.status === "failed";
}

export function isLookbackSaving(item: RecordingContextItem | null): boolean {
  return item?.status === "pending" || item?.status === "processing";
}
