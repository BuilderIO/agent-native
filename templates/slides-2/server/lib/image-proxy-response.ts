export function buildImageProxyResponseHeaders(
  contentType: string,
  contentLength: number,
  publicShare: boolean,
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Length": String(contentLength),
    "Cache-Control": publicShare
      ? "private, no-store"
      : "private, max-age=3600",
    "Access-Control-Allow-Origin": "*",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
}
