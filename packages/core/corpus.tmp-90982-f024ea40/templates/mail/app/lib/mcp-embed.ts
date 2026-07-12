export function isMcpEmbedSurface(): boolean {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get("embedded");
  return value === "1" || value === "true";
}
