export function bookingOgImageResponseHeaders(
  byteLength: number,
): Record<string, string> {
  return {
    "Content-Type": "image/png",
    "Content-Length": String(byteLength),
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}
