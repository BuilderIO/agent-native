export function reviewThreadIdFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("comment");
  const threadId = value?.trim();
  return threadId || null;
}
