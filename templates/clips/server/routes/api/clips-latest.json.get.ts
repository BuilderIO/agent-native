import { defineEventHandler, setResponseHeaders, createError } from "h3";

/**
 * Same-origin endpoint that tells the download page which user-facing
 * installers (DMG / MSI / AppImage) are available for the latest
 * published Clips Desktop release.
 *
 * Why NOT just proxy the Tauri updater manifest (`clips-latest.json`
 * on the `clips-latest` release)? The updater manifest lists *updater*
 * artifacts — `.app.tar.gz`, `.msi.zip`, `.AppImage.tar.gz` — which are
 * patch bundles for the already-installed app. End users arriving at
 * /download want the raw installers (.dmg / .msi / .exe / .AppImage).
 *
 * This route therefore hits GitHub's REST API, paginates through
 * releases until it finds the most recent published `clips-v*` release,
 * and returns its asset list plus metadata.
 *
 * ## Rate-limit hardening
 *
 * GitHub's unauthenticated REST API caps at 60 requests/hour/IP, so a
 * modest burst of downloads would 429. We guard against that with:
 *
 *   - A 5-minute process-wide memoization (`cached`) — every request
 *     for 5 min shares one upstream fetch.
 *   - A stale-while-error fallback — if GitHub ever errors out AND we
 *     have a previously-successful payload (even expired), we return
 *     it. Avoids a download outage during a transient GitHub hiccup or
 *     a rate-limit burst.
 *   - HTTP `cache-control: max-age=60` on the response so downstream
 *     CDNs + the browser cache this aggressively.
 */

const RELEASES_URL_BASE =
  "https://api.github.com/repos/BuilderIO/agent-native/releases";
const PER_PAGE = 100;
// Up to 10 pages = 1000 releases. If clips-v* hasn't shown up by then,
// something else is wrong and the 404 is correct.
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

export interface DownloadManifest {
  version: string;
  tag: string;
  pub_date: string | null;
  notes?: string;
  assets: {
    name: string;
    url: string;
    size: number;
    /**
     * Classification used by the download UI. `"unknown"` is left in
     * place for anything that doesn't obviously match an installer
     * pattern (updater archives, .sig files, etc.) — the UI ignores
     * those.
     */
    kind:
      | "mac-universal"
      | "mac-arm64"
      | "mac-x64"
      | "windows-msi"
      | "windows-exe"
      | "linux-appimage"
      | "linux-deb"
      | "linux-rpm"
      | "unknown";
  }[];
}

function classifyAsset(
  name: string,
): DownloadManifest["assets"][number]["kind"] {
  const n = name.toLowerCase();
  // Skip updater archives + signature files explicitly.
  if (
    n.endsWith(".sig") ||
    n.endsWith(".app.tar.gz") ||
    n.endsWith(".msi.zip") ||
    n.endsWith(".appimage.tar.gz")
  ) {
    return "unknown";
  }
  if (n.endsWith(".dmg")) {
    if (n.includes("universal")) return "mac-universal";
    if (n.includes("aarch64") || n.includes("arm64")) return "mac-arm64";
    if (n.includes("x64") || n.includes("x86_64")) return "mac-x64";
    // No arch hint — assume universal (default target of clips workflow).
    return "mac-universal";
  }
  if (n.endsWith(".msi")) return "windows-msi";
  if (n.endsWith(".exe")) return "windows-exe";
  if (n.endsWith(".appimage")) return "linux-appimage";
  if (n.endsWith(".deb")) return "linux-deb";
  if (n.endsWith(".rpm")) return "linux-rpm";
  return "unknown";
}

let cache: { data: DownloadManifest; ts: number } | null = null;
let inFlight: Promise<DownloadManifest> | null = null;

async function fetchPage(page: number): Promise<GhRelease[]> {
  const url = `${RELEASES_URL_BASE}?per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "clips-download-page",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Upstream releases fetch failed (${res.status})`);
  }
  return (await res.json()) as GhRelease[];
}

async function findLatestClipsRelease(): Promise<GhRelease | null> {
  let best: GhRelease | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await fetchPage(page);
    if (batch.length === 0) break;
    for (const r of batch) {
      if (r.draft || r.prerelease) continue;
      if (!r.tag_name.startsWith("clips-v")) continue;
      if (
        !best ||
        new Date(r.published_at).getTime() >
          new Date(best.published_at).getTime()
      ) {
        best = r;
      }
    }
    // Releases are returned newest-first by GitHub. Once we've seen a
    // clips-v* match on any page, subsequent pages can only hold older
    // matches — safe to stop.
    if (best) break;
    if (batch.length < PER_PAGE) break;
  }
  return best;
}

async function buildManifest(): Promise<DownloadManifest> {
  const latest = await findLatestClipsRelease();
  if (!latest) {
    throw createError({
      statusCode: 404,
      statusMessage: "No published clips-v* release found",
    });
  }
  return {
    version: latest.tag_name.replace(/^clips-v/, ""),
    tag: latest.tag_name,
    pub_date: latest.published_at,
    notes: latest.body,
    assets: latest.assets.map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
      kind: classifyAsset(a.name),
    })),
  };
}

async function getManifest(): Promise<DownloadManifest> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await buildManifest();
      cache = { data, ts: Date.now() };
      return data;
    } catch (err) {
      // Stale-while-error: if we have an older payload, serve it. Only
      // bubble the error if the cache is empty.
      if (cache) return cache.data;
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export default defineEventHandler(async (event) => {
  let manifest: DownloadManifest;
  try {
    manifest = await getManifest();
  } catch (err) {
    const e = err as { statusCode?: number; statusMessage?: string };
    const status = typeof e.statusCode === "number" ? e.statusCode : 502;
    const msg = e.statusMessage ?? "Upstream releases fetch failed";
    throw createError({ statusCode: status, statusMessage: msg });
  }
  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return manifest;
});
