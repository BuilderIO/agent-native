export type RewindStartErrorKind =
  | "permission"
  | "unsupported"
  | "diskSpace"
  | "recording"
  | "storage"
  | "unknown";

export function getRewindStartErrorKind(error: unknown): RewindStartErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("screen recording permission") ||
    normalized.includes("screen capture permission") ||
    normalized.includes("declined tcc") ||
    normalized.includes("window, display capture") ||
    (normalized.includes("screen recording") &&
      (normalized.includes("permission") || normalized.includes("privacy")))
  ) {
    return "permission";
  }
  if (normalized.includes("screen memory capture is currently macos-only")) {
    return "unsupported";
  }
  if (normalized.includes("not enough disk space to start screen memory")) {
    return "diskSpace";
  }
  if (
    normalized.includes(
      "rewind capture settings stay unchanged while a clip is recording",
    )
  ) {
    return "recording";
  }
  if (
    normalized.includes("app data directory") ||
    normalized.includes("no app_data_dir") ||
    normalized.includes("write tmp:") ||
    normalized.includes("rename:") ||
    normalized.includes("screen memory directory") ||
    normalized.includes("screen memory events") ||
    normalized.includes("screen memory metadata")
  ) {
    return "storage";
  }
  return "unknown";
}
