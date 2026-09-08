export const DEFAULT_RECORDING_TITLE = "Untitled recording";

export const RECORDING_TITLE_SOURCES = [
  "default",
  "context",
  "upload",
  "ai",
  "manual",
] as const;

export type RecordingTitleSource = (typeof RECORDING_TITLE_SOURCES)[number];

export function isDefaultTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return !trimmed || trimmed === DEFAULT_RECORDING_TITLE;
}

export function isAutoTitleReplaceable(
  title: string | null | undefined,
  titleSource: string | null | undefined,
): boolean {
  return (
    isDefaultTitle(title) ||
    titleSource === "default" ||
    titleSource === "context"
  );
}
