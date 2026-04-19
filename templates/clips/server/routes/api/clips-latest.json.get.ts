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
 * This route therefore hits GitHub's REST API, finds the most recent
 * release whose tag starts with `clips-v`, and returns its asset list
 * plus metadata. GitHub's API does CORS correctly, but we still proxy
 * server-side so:
 *   - rate limits hit one IP (the server), not every visitor.
 *   - the download page stays portable — it only touches same-origin.
 *   - we can add caching (`cache-control: max-age=60`).
 */

const RELEASES_URL =
  "https://api.github.com/repos/BuilderIO/agent-native/releases?per_page=50";

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

export default defineEventHandler(async (event) => {
  let res: Response;
  try {
    res = await fetch(RELEASES_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "clips-download-page",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "Upstream releases fetch timed out"
        : "Upstream releases fetch failed";
    throw createError({ statusCode: 502, statusMessage: reason });
  }
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Upstream releases fetch failed (${res.status})`,
    });
  }
  const releases = (await res.json()) as GhRelease[];
  const latest = releases
    .filter(
      (r) => !r.draft && !r.prerelease && r.tag_name.startsWith("clips-v"),
    )
    .sort(
      (a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    )[0];
  if (!latest) {
    throw createError({
      statusCode: 404,
      statusMessage: "No published clips-v* release found",
    });
  }
  const manifest: DownloadManifest = {
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
  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return manifest;
});
