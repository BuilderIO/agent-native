import { isNonPublicHostname } from "@agent-native/core/shared/public-host";

import {
  designConnectionIdsFromData,
  designSourceTypeFromData,
} from "./source-mode";

function publicTunnelUrl(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isNonPublicHostname(url.hostname)
  )
    return null;
  url.hash = "";
  url.search = "";
  return url;
}

/**
 * Checks the name only. Viewers' browsers load this URL directly, so the save
 * path must also reject a name that resolves to a private address.
 */
export function normalizeVisualEditTunnelUrl(value: string): string {
  const url = publicTunnelUrl(value);
  if (!url)
    throw new Error("Use a public HTTPS preview hostname without credentials.");
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
  const base = tunnelUrl ? publicTunnelUrl(tunnelUrl) : null;
  // A mapping saved before a stricter rule landed falls back to the snapshot.
  if (!base || !localUrl) return undefined;
  const local = new URL(localUrl);
  const tunnel = new URL(base.href.replace(/\/$/, "") + "/");
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
