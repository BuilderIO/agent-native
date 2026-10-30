/**
 * Origins Builder's web app is served from. Design is mounted behind them (the
 * host's `/an/design` proxy), so these are the browser origins its requests
 * can carry.
 */
export const BUILDER_HOST_FRAME_ANCESTORS = [
  "https://builder.io",
  "https://*.builder.io",
  "https://*.builder.my",
  "http://localhost:*",
  "http://127.0.0.1:*",
] as const;

const BUILDER_HOST_SUFFIXES = [".builder.io", ".builder.my"];

export function isBuilderHostOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  if (url.username || url.password || url.pathname !== "/") return false;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  if (url.protocol !== "https:" || url.port) return false;
  return (
    url.hostname === "builder.io" ||
    BUILDER_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  );
}
