export const DEFAULT_RECORDING_TITLE = "Untitled recording";

export const RECORDING_TITLE_SOURCES = [
  "default",
  "context",
  "upload",
  "ai",
  "manual",
] as const;

export type RecordingTitleSource = (typeof RECORDING_TITLE_SOURCES)[number];

export type RegenerateTitleResult = {
  updated?: boolean;
  queued?: boolean;
  skipped?: boolean;
  reason?: string;
  kind?: string;
  requestedAt?: string | null;
};

export function titleRegenerationSkipDisposition(
  reason: string | undefined,
): "dismiss" | "transcript" | "credits" | "failed" {
  if (reason === "title_changed") return "dismiss";
  if (reason === "transcript_not_ready") return "transcript";
  if (reason === "builder_credits_paused") return "credits";
  return "failed";
}

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
  if (titleSource === "manual") return false;
  return (
    isDefaultTitle(title) ||
    (AUTO_REPLACEABLE_TITLE_SOURCES as readonly string[]).includes(
      titleSource ?? "",
    )
  );
}

export function shouldPollGeneratedTitle(
  recording: {
    title: string | null | undefined;
    createdAt?: string | null;
  },
  transcriptStatus?: string,
  now = Date.now(),
): boolean {
  if (transcriptStatus === "failed") return false;
  if (!isDefaultTitle(recording.title)) return false;
  const timestamp = Date.parse(recording.createdAt ?? "");
  return Number.isFinite(timestamp) && now - timestamp <= 2 * 60 * 1000;
}
