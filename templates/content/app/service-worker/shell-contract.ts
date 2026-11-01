/**
 * Names shared by Content's app-shell service worker, the build step that
 * writes it and the page that registers it.
 *
 * The worker keeps two kinds of response and nothing else: the public HTML
 * shell of the app's own routes, and the build's content-hashed `/assets/*`
 * files. API, auth, collab and every other request never reach its caches.
 * To remove the worker from every browser, build with
 * `VITE_CONTENT_SERVICE_WORKER=off`: that build ships a worker that deletes its
 * caches and unregisters itself, and pages it serves unregister it too.
 */
export const SHELL_WORKER_URL = "/sw.js";
export const SHELL_WORKER_SCOPE = "/";
export const SHELL_WORKER_ENV = "VITE_CONTENT_SERVICE_WORKER";
export const SHELL_WORKER_OFF = "off";

// Bump the version when the cache layout changes. The worker deletes every
// `content-shell-` cache of another version when it activates.
export const SHELL_CACHE_PREFIX = "content-shell-";
const SHELL_CACHE_VERSION = "v1";
export const SHELL_CACHE_NAMES = {
  assets: `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}-assets`,
  pages: `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}-pages`,
  state: `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}-state`,
} as const;

export const SHELL_ADOPT_MESSAGE = "content-shell:adopt";

// Same rule as core's IMMUTABLE_ASSET_PATH_PATTERN: only files whose name
// carries a content hash, so a cached copy can never go stale.
export const IMMUTABLE_ASSET_PATH =
  /^\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

export interface ShellRoute {
  id: string;
  /** Full URL pattern, such as `/page/:id` or `/settings/*`. */
  pattern: string;
  /** Whether the worker may serve this route's HTML from its cache. */
  app: boolean;
}

/**
 * What one build's shell needs, written next to its assets as
 * `/assets/sw-build-<version>.json`, where `version` is React Router's
 * manifest version, the 8-character hash in `/assets/manifest-<version>.js`.
 */
export interface ShellBuildFile {
  version: string;
  /** The entry, every route module and their static imports and CSS. */
  boot: string[];
  /** Every content-hashed file of the build, lazy chunks included. */
  assets: string[];
  routes: ShellRoute[];
}

const BUILD_VERSION = /^[A-Za-z0-9_-]{8}$/;

export function isShellBuildVersion(value: string): boolean {
  return BUILD_VERSION.test(value);
}

export function shellBuildFilePath(version: string): string {
  return `/assets/sw-build-${version}.json`;
}

export async function deleteShellCaches(storage: CacheStorage): Promise<void> {
  const names = await storage.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(SHELL_CACHE_PREFIX))
      .map((name) => storage.delete(name)),
  );
}
