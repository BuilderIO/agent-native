import type { MediaBlockType } from "./types.js";

export type EmbedKind = Exclude<MediaBlockType, "IMAGE">;

export type EmbedSource = {
  src: string;
  /** Known providers get same-origin access for their player; others do not. */
  trusted: boolean;
};

function parseHttp(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    // coercion-ok: an unparsable string is simply not a usable link.
    return null;
  }
}

/** `http(s)` or site-relative; anything else (`javascript:`, `data:`) is refused. */
export function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return parseHttp(url) ? url : null;
}

const bareHost = (url: URL) => url.hostname.replace(/^(www|m)\./, "");

function videoSource(url: URL): string | null {
  const host = bareHost(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be" && parts[0])
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(parts[0])}`;
  if (host === "youtube.com") {
    const id =
      url.searchParams.get("v") ??
      (["embed", "shorts", "live"].includes(parts[0] ?? "") ? parts[1] : null);
    if (id)
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((part) => /^\d+$/.test(part));
    if (id) return `https://player.vimeo.com/video/${id}`;
  }
  if (host === "loom.com" && ["share", "embed"].includes(parts[0] ?? "")) {
    const id = parts[1];
    if (id) return `https://www.loom.com/embed/${encodeURIComponent(id)}`;
  }
  return null;
}

function audioSource(url: URL): string | null {
  const host = bareHost(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "open.spotify.com") {
    const [kind, id] = parts;
    if (
      id &&
      ["track", "episode", "album", "playlist", "show", "artist"].includes(
        kind ?? "",
      )
    )
      return `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
  }
  if (host === "soundcloud.com" && parts.length >= 2)
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.origin + url.pathname)}`;
  return null;
}

function mapSource(url: URL): string | null {
  const host = bareHost(url);
  if (host === "openstreetmap.org" && url.pathname === "/export/embed.html")
    return url.toString();
  const isGoogle = host === "google.com" || host === "maps.google.com";
  if (!isGoogle) return null;
  if (url.pathname.startsWith("/maps/embed")) return url.toString();
  const place = url.pathname.match(/^\/maps\/place\/([^/]+)/)?.[1];
  const query =
    url.searchParams.get("q") ??
    (place ? decodeURIComponent(place.replace(/\+/g, " ")) : null);
  if (!query) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

/** The iframe source for a pasted link, or null when the provider is not allowed. */
export function resolveEmbed(
  kind: EmbedKind,
  value: unknown,
): EmbedSource | null {
  if (typeof value !== "string") return null;
  const url = parseHttp(value);
  if (!url) return null;
  if (kind === "EMBED_LINK") return { src: url.toString(), trusted: false };
  const src =
    kind === "EMBED_VIDEO"
      ? videoSource(url)
      : kind === "EMBED_AUDIO"
        ? audioSource(url)
        : mapSource(url);
  return src ? { src, trusted: true } : null;
}
