export function bookingOgImageResponseHeaders(
  byteLength?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (typeof byteLength === "number") {
    headers["Content-Length"] = String(byteLength);
  }
  return headers;
}
