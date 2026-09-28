export function nextDocumentUpdatedAt(
  currentUpdatedAt: string,
  requestedMs = Date.now(),
): string {
  const currentMs = new Date(currentUpdatedAt).getTime();
  return new Date(Math.max(requestedMs, currentMs + 1)).toISOString();
}
