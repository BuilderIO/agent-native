export function reviewThreadIdFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const value = params.get("comment") ?? params.get("review-thread");
  const threadId = value?.trim();
  return threadId || null;
}
