import { defineEventHandler, setResponseHeaders } from "h3";

/**
 * Tauri updater manifest endpoint for the Clips desktop app.
 *
 * The installed app only needs this endpoint to be valid JSON when no signed
 * updater bundle is available. If the `clips-latest` GitHub pointer release
 * exists, we proxy its signed manifest. If it does not, return a deliberately
 * old no-update manifest so the desktop UI stays quiet instead of surfacing a
 * release-channel setup error to end users.
 */

const GITHUB_MANIFEST_URL =
  "https://github.com/BuilderIO/agent-native/releases/download/clips-latest/clips-latest.json";
const CACHE_TTL_MS = 5 * 60_000;

// Tauri throws a red-banner error if the requesting client's target triple is
// missing from `platforms`. We ship Universal macOS, Windows, and Linux, so the
// manifest must always carry all targets — if upstream is incomplete, fall
// back to inert so no client sees a hard error.
export const REQUIRED_PLATFORM_KEYS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
  "linux-x86_64",
];

const INERT_PLATFORM = {
  url: "https://clips.agent-native.com/download",
  signature: "updates-disabled",
};

export const INERT_MANIFEST = {
  version: "0.0.0",
  notes:
    "Automatic updates are temporarily unavailable. Download the latest Clips installer from https://clips.agent-native.com/download.",
  pub_date: "2026-05-04T00:00:00Z",
  platforms: {
    "darwin-aarch64-app": INERT_PLATFORM,
    "darwin-aarch64": INERT_PLATFORM,
    "darwin-x86_64-app": INERT_PLATFORM,
    "darwin-x86_64": INERT_PLATFORM,
    "windows-x86_64-nsis": INERT_PLATFORM,
    "windows-x86_64-msi": INERT_PLATFORM,
    "windows-x86_64": INERT_PLATFORM,
    "linux-x86_64-appimage": INERT_PLATFORM,
    "linux-x86_64": INERT_PLATFORM,
  },
};

let cache: { data: unknown; ts: number } | null = null;
let inFlight: Promise<unknown> | null = null;

function isManifestLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== "string") return false;
  if (
    obj.url &&
    typeof obj.url === "string" &&
    typeof obj.signature === "string"
  ) {
    return true;
  }
  return !!obj.platforms && typeof obj.platforms === "object";
}

export function hasAllRequiredPlatforms(value: unknown): boolean {
  if (!isManifestLike(value)) return false;
  const platforms = value.platforms as Record<string, unknown> | undefined;
  if (!platforms || typeof platforms !== "object") return false;
  return REQUIRED_PLATFORM_KEYS.every((k) => k in platforms);
}

async function fetchSignedManifest(): Promise<unknown> {
  const res = await fetch(GITHUB_MANIFEST_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "clips-updater-manifest",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub updater manifest ${res.status}`);
  const json = (await res.json()) as unknown;
  if (!isManifestLike(json)) throw new Error("Invalid updater manifest");
  if (!hasAllRequiredPlatforms(json)) {
    const present = Object.keys(
      (json as { platforms?: Record<string, unknown> }).platforms ?? {},
    );
    throw new Error(
      `Updater manifest missing required platforms; got [${present.join(", ")}]`,
    );
  }
  return json;
}

async function getManifest(): Promise<unknown> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const data = await fetchSignedManifest();
      cache = { data, ts: Date.now() };
      return data;
    } catch {
      // A validation or network failure may serve the last good manifest (or
      // inert fallback), but it must not make that fallback fresh again.
      // Otherwise an incomplete release manifest can indefinitely extend the
      // stale cache window on every failed refresh.
      return cache?.data ?? INERT_MANIFEST;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export const __clipsUpdaterTest = {
  getManifest,
  reset() {
    cache = null;
    inFlight = null;
  },
};

export default defineEventHandler(async (event) => {
  const manifest = await getManifest();
  setResponseHeaders(event, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
  });
  return manifest;
});
