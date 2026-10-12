const FIRST_RUN_STORAGE_SETUP_DISMISSED_KEY =
  "clips:first-run-storage-setup-dismissed";

export type FirstRunStorageSetupDismissal =
  | "dismissed"
  | "not-dismissed"
  | "unavailable";

export function readFirstRunStorageSetupDismissal(): FirstRunStorageSetupDismissal {
  if (typeof window === "undefined") return "unavailable";
  try {
    return window.localStorage.getItem(
      FIRST_RUN_STORAGE_SETUP_DISMISSED_KEY,
    ) === "true"
      ? "dismissed"
      : "not-dismissed";
  } catch {
    return "unavailable";
  }
}

export function saveFirstRunStorageSetupDismissal(): "saved" | "unavailable" {
  if (typeof window === "undefined") return "unavailable";
  try {
    window.localStorage.setItem(FIRST_RUN_STORAGE_SETUP_DISMISSED_KEY, "true");
    return "saved";
  } catch {
    return "unavailable";
  }
}
