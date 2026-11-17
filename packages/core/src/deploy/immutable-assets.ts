import fs from "fs";
import path from "path";

export const IMMUTABLE_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

// An MCP App panel mounts the app inside the host's sandbox origin and imports
// these chunks from there; module imports are CORS requests, so without this
// header the panel renders nothing. The files are public and fetched without
// credentials.
export const IMMUTABLE_ASSET_CORS_ORIGIN = "*";

export const IMMUTABLE_ASSET_CACHE_HEADERS = {
  "cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
  "cdn-cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
  "netlify-cdn-cache-control": IMMUTABLE_ASSET_CACHE_CONTROL,
  "access-control-allow-origin": IMMUTABLE_ASSET_CORS_ORIGIN,
} as const;

export const IMMUTABLE_ASSET_PATH_PATTERN =
  "^/assets/(?:[^/]+/)*(?:[^/]+-(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{16})\\.[a-z0-9]+|m-[A-Za-z0-9_-]{8}[0-9]+\\.js)$";

const IMMUTABLE_ASSET_PATH_RE = new RegExp(IMMUTABLE_ASSET_PATH_PATTERN);

export function isImmutableAssetPath(pathname: string): boolean {
  return IMMUTABLE_ASSET_PATH_RE.test(pathname);
}

export function normalizeBasePath(basePath: string | undefined): string {
  const raw = String(basePath ?? "").trim();
  if (!raw || raw === "/") return "";
  const normalized = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized ? `/${normalized}` : "";
}

export function prefixAssetPath(
  pathname: string,
  basePath: string | undefined,
): string {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname;
  return `${base}${pathname}`;
}

export function collectImmutableAssetPaths(rootDir: string): string[] {
  const assetsDir = path.join(rootDir, "assets");
  if (!fs.existsSync(assetsDir)) return [];

  const paths: string[] = [];
  const scan = (dir: string, relDir = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const assetPath = `/assets/${relPath}`;
      if (isImmutableAssetPath(assetPath)) paths.push(assetPath);
    }
  };

  scan(assetsDir);
  return paths.sort();
}
