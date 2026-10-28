export function isMcpEmbedSurface(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("embedded");
  const chatFirst = params.get("chatFirst");
  return (
    (value === "1" || value === "true") &&
    chatFirst !== "1" &&
    chatFirst !== "true"
  );
}
