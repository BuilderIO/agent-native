import { createError, defineEventHandler, setResponseHeaders } from "h3";

const RELEASES_URL_BASE =
  "https://api.github.com/repos/BuilderIO/agent-native/releases";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const CACHE_TTL_MS = 5 * 60_000;

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GhRelease {
  tag_name: string;
  name: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
  body?: string;
}

type DesktopAssetKind =
  | "mac-arm64"
  | "mac-x64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-appimage-x64"
  | "linux-appimage-arm64"
  | "linux-deb-x64"
  | "linux-deb-arm64"
  | "unknown";

export interface DesktopDownloadManifest {
  version: string;
  tag: string;
  pub_date: string | null;
  notes?: string;
  assets: {
    name: string;
    url: string;
    size: number;
    kind: DesktopAssetKind;
  }[];
}

let cache: { data: DesktopDownloadManifest; ts: number } | null = null;
let inFlight: Promise<DesktopDownloadManifest> | null = null;

class UpstreamError extends Error {
  statusCode: number;

  constructor(status: number, message: string) {
    super(message);
    this.statusCode = status;
  }
}

function isAgentNativeAsset(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("agent-native-") || n.startsWith("agent native-");
}

export function classifyDesktopAsset(name: string): DesktopAssetKind {
  if (!isAgentNativeAsset(name)) return "unknown";
  const n = name.toLowerCase();
  if (n.endsWith(".dmg")) {
    if (n.includes("arm64") || n.includes("aarch64")) return "mac-arm64";
    if (n.includes("x64") || n.includes("x86_64") || n.includes("amd64")) {
      return "mac-x64";
    }
  }
  if (n.endsWith(".exe")) {
    return n.includes("arm64") || n.includes("aarch64")
      ? "windows-arm64"
      : "windows-x64";
  }
  if (n.endsWith(".appimage")) {
    return n.includes("arm64") || n.includes("aarch64")
      ? "linux-appimage-arm64"
      : "linux-appimage-x64";
  }
  if (n.endsWith(".deb")) {
    return n.includes("arm64") || n.includes("aarch64")
      ? "linux-deb-arm64"
      : "linux-deb-x64";
  }
  return "unknown";
}

async function fetchPage(page: number): Promise<GhRelease[]> {
  const res = await fetch(
    `${RELEASES_URL_BASE}?per_page=${PER_PAGE}&page=${page}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "agent-native-docs-download-page",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    throw new UpstreamError(
      res.status,
      `Upstream releases fetch failed (${res.status})`,
    );
  }
  return (await res.json()) as GhRelease[];
}

function hasDesktopAssets(release: GhRelease): boolean {
  return release.assets.some(
    (asset) => classifyDesktopAsset(asset.name) !== "unknown",
  );
}

async function findLatestDesktopRelease(): Promise<GhRelease | null> {
  let best: GhRelease | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(page);
    if (batch.length === 0) break;
    for (const release of batch) {
      if (release.draft || release.prerelease) continue;
      if (!hasDesktopAssets(release)) continue;
      if (
        !best ||
        new Date(release.published_at).getTime() >
          new Date(best.published_at).getTime()
      ) {
        best = release;
      }
    }
    if (batch.length < PER_PAGE) break;
  }
  return best;
}

async function buildManifest(): Promise<DesktopDownloadManifest> {
  const latest = await findLatestDesktopRelease();
  if (!latest) {
    throw createError({
      statusCode: 404,
      statusMessage: "No published desktop release found",
    });
  }

  return {
    version: latest.tag_name.replace(/^v/, ""),
    tag: latest.tag_name,
    pub_date: latest.published_at,
    notes: latest.body,
    assets: latest.assets.map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      kind: classifyDesktopAsset(asset.name),
    })),
  };
}

async function getManifest(): Promise<DesktopDownloadManifest> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await buildManifest();
      cache = { data, ts: Date.now() };
      return data;
    } catch (error) {
      if (cache) return cache.data;
      throw error;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export default defineEventHandler(async (event) => {
  let manifest: DesktopDownloadManifest;
  try {
    manifest = await getManifest();
  } catch (error) {
    const e = error as {
      statusCode?: number;
      statusMessage?: string;
      message?: string;
    };
    throw createError({
      statusCode: typeof e.statusCode === "number" ? e.statusCode : 502,
      statusMessage:
        e.statusMessage ?? e.message ?? "Upstream releases fetch failed",
    });
  }

  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return manifest;
});
