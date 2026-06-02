export function bookingOgImageResponseHeaders(
  byteLength: number,
): Record<string, string> {
  const cacheControl =
    "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600";
  return {
    "Content-Type": "image/png",
    "Content-Length": String(byteLength),
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cacheControl,
    "Netlify-CDN-Cache-Control": `public, durable, max-age=60, stale-while-revalidate=604800, stale-if-error=3600`,
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}
