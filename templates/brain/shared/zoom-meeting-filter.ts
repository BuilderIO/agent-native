// Zoom shows meeting IDs as "123 4567 8901"; the API returns 12345678901.
export function normalizeZoomMeetingId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).replace(/[\s-]/g, "");
  return /^\d{6,15}$/.test(id) ? id : null;
}

export function normalizeZoomMeetingTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const topic = value.trim().replace(/\s+/g, " ").toLowerCase();
  return topic || null;
}

export function zoomFilterLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function invalidZoomMeetingIds(value: string): string[] {
  return zoomFilterLines(value).filter(
    (line) => normalizeZoomMeetingId(line) === null,
  );
}
