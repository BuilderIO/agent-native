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

/** Title sources an auto-generated title may overwrite. */
export const AUTO_REPLACEABLE_TITLE_SOURCES = [
  "default",
  "context",
] as const satisfies readonly RecordingTitleSource[];

export function isAutoTitleReplaceable(
  title: string | null | undefined,
  titleSource: string | null | undefined,
): boolean {
  return (
    isDefaultTitle(title) ||
    (AUTO_REPLACEABLE_TITLE_SOURCES as readonly string[]).includes(
      titleSource ?? "",
    )
  );
}
