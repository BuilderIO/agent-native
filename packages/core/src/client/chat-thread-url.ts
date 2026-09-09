export function hasChatThreadDeepLink(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return Boolean(
      params.get("thread")?.trim() || params.get("threadId")?.trim(),
    );
  } catch {
    return false;
  }
}
