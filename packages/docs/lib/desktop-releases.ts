import { createError } from "h3";

const RELEASES_URL_BASE =
  "https://api.github.com/repos/BuilderIO/agent-native/releases";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const CACHE_FRESH_MS = 5 * 60_000;

export const DESKTOP_RELEASE_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400";

export const DESKTOP_RELEASE_CACHE_HEADERS = {
  "cache-control": DESKTOP_RELEASE_CACHE_CONTROL,
  "cdn-cache-control": DESKTOP_RELEASE_CACHE_CONTROL,
  "netlify-cdn-cache-control":
    "public, durable, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
} as const;

const DESKTOP_UPDATE_METADATA = new Set([
  "latest-mac.yml",
  "latest.yml",
  "latest-linux.yml",
  "latest-linux-arm64.yml",
]);

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

export type DesktopAssetKind =
  | "mac-arm64"
  | "mac-x64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-tar-x64"
  | "linux-tar-arm64"
  | "linux-appimage-x64"
  | "linux-appimage-arm64"
  | "linux-deb-x64"
  | "linux-deb-arm64"
  | "unknown";

export type DesktopReleaseChannel = "production" | "nightly";

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

class UpstreamError extends Error {
  statusCode: number;

  constructor(status: number, message: string) {
    super(message);
    this.statusCode = status;
  }
}

function isAgentNativeAsset(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith("agent-native-") ||
    n.startsWith("agent native-") ||
    n.startsWith("agent.native-")
  );
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
  if (n.endsWith(".tar.xz")) {
    return n.includes("arm64") || n.includes("aarch64")
      ? "linux-tar-arm64"
      : "linux-tar-x64";
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

export function isDesktopUpdateMetadataAsset(name: string): boolean {
  return DESKTOP_UPDATE_METADATA.has(name);
}

function isDesktopMacUpdateZipAsset(name: string): boolean {
  const n = name.toLowerCase();
  return isAgentNativeAsset(name) && n.endsWith("-mac.zip");
}

export function isDesktopUpdaterAsset(name: string): boolean {
  return (
    classifyDesktopAsset(name) !== "unknown" ||
    isDesktopUpdateMetadataAsset(name) ||
    isDesktopMacUpdateZipAsset(name) ||
    (isAgentNativeAsset(name) && name.toLowerCase().endsWith(".blockmap"))
  );
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

function belongsToChannel(
  release: GhRelease,
  channel: DesktopReleaseChannel,
): boolean {
  if (release.draft || !hasDesktopAssets(release)) return false;

  const tag = release.tag_name;
  if (channel === "production") {
    // Production releases are deliberately exact semver tags. This excludes
    // both Nightly prereleases and legacy auto-build tags such as v0.1.7-42.
    return !release.prerelease && /^v\d+\.\d+\.\d+$/.test(tag);
  }

  return (
    (release.prerelease || /-nightly(?:[.+-]|$)/i.test(tag)) &&
    /^v\d+\.\d+\.\d+-nightly(?:[.+-]|$)/i.test(tag)
  );
}

async function findLatestDesktopRelease(
  channel: DesktopReleaseChannel,
): Promise<GhRelease | null> {
  let best: GhRelease | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(page);
    if (batch.length === 0) break;
    for (const release of batch) {
      if (!belongsToChannel(release, channel)) continue;
      if (
        !best ||
        new Date(release.published_at).getTime() >
          new Date(best.published_at).getTime()
      ) {
        best = release;
      }
    }
    // GitHub returns releases newest-first. Once this page has a published
    // desktop release, older pages cannot contain a newer candidate.
    if (best) return best;
    if (batch.length < PER_PAGE) break;
  }
  return best;
}

async function buildManifest(
  channel: DesktopReleaseChannel,
): Promise<DesktopDownloadManifest> {
  const latest = await findLatestDesktopRelease(channel);
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

function refreshDesktopDownloadManifest(
  channel: DesktopReleaseChannel,
): Promise<DesktopDownloadManifest> {
  const pending = inFlight.get(channel);
  if (pending) return pending;
  const request = (async () => {
    const data = await buildManifest(channel);
    cache.set(channel, { data, ts: Date.now() });
    return data;
  })();
  inFlight.set(
    channel,
    request.finally(() => {
      inFlight.delete(channel);
    }),
  );
  return inFlight.get(channel)!;
}

const cache = new Map<
  DesktopReleaseChannel,
  { data: DesktopDownloadManifest; ts: number }
>();
const inFlight = new Map<
  DesktopReleaseChannel,
  Promise<DesktopDownloadManifest>
>();

export async function getDesktopDownloadManifest(
  channel: DesktopReleaseChannel = "production",
): Promise<DesktopDownloadManifest> {
  const now = Date.now();
  const cached = cache.get(channel);
  if (cached) {
    if (now - cached.ts >= CACHE_FRESH_MS) {
      void refreshDesktopDownloadManifest(channel).catch(() => undefined);
    }
    return cached.data;
  }
  return refreshDesktopDownloadManifest(channel);
}

export function getDesktopReleaseError(error: unknown): {
  statusCode: number;
  statusMessage: string;
} {
  const e = error as {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
  };
  return {
    statusCode: typeof e.statusCode === "number" ? e.statusCode : 502,
    statusMessage:
      e.statusMessage ?? e.message ?? "Upstream releases fetch failed",
  };
}

export function resetDesktopDownloadManifestCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
