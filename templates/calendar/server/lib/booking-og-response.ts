export function bookingOgImageResponseHeaders(
  byteLength?: number,
  contentType = "image/png",
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (typeof byteLength === "number") {
    headers["Content-Length"] = String(byteLength);
  }
  return headers;
}
