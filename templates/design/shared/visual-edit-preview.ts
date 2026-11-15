import {
  designConnectionIdsFromData,
  designSourceTypeFromData,
} from "./source-mode";

export function normalizeVisualEditTunnelUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  ) {
    throw new Error("Use a public HTTPS tunnel hostname without credentials.");
  }
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/$/, "");
}

export function visualEditPreviewForViewer({
  localUrl,
  tunnelUrl,
  isOwner,
}: {
  localUrl?: string | undefined;
  tunnelUrl?: string | undefined;
  isOwner: boolean;
}): string | undefined {
  if (isOwner) return localUrl;
  if (!tunnelUrl || !localUrl) return undefined;
  const local = new URL(localUrl);
  const tunnel = new URL(normalizeVisualEditTunnelUrl(tunnelUrl) + "/");
  tunnel.pathname = `${tunnel.pathname.replace(/\/$/, "")}${local.pathname}`;
  tunnel.search = local.search;
  tunnel.hash = local.hash;
  return tunnel.href;
}

export function designSharePath(id: string, data: unknown): string {
  const local =
    designSourceTypeFromData(data) === "localhost" ||
    designConnectionIdsFromData(data).length > 0;
  return local
    ? `/visual-edit/${encodeURIComponent(id)}?share=1&editorView=overview`
    : `/design/${encodeURIComponent(id)}`;
}
