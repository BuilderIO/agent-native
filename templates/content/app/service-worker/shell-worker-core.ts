import {
  IMMUTABLE_ASSET_PATH,
  SHELL_CACHE_NAMES,
  SHELL_CACHE_PREFIX,
  SHELL_WORKER_URL,
  deleteShellCaches,
  isShellBuildVersion,
  shellBuildFilePath,
  type ShellBuildFile,
  type ShellRoute,
} from "./shell-contract";
import {
  isShareableShellResponse,
  shellAssetReferences,
  shellBuildVersion,
} from "./shell-html";
import { matchShellRoute } from "./shell-routes";

/**
 * Content's app-shell worker, written against a small environment so specs
 * can drive it without a browser. `shell-worker.ts` wires it to the real
 * service worker scope.
 *
 * A navigation to one of the app's routes gets the cached shell of the
 * current build at once, and the network copy is checked behind it. When that
 * copy names a newer build, the worker first caches every file the new
 * build's shell boots, then makes it current, so the next navigation runs the
 * new build and the open one never changes under the user. The two newest
 * builds keep their files, so a tab still running the older one can load its
 * lazy chunks.
 */

export interface ShellWorkerEnvironment {
  origin: string;
  caches: CacheStorage;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  now(): number;
  unregister(): Promise<boolean>;
}

export interface ShellFetchEvent {
  readonly request: Request;
  readonly preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

interface ShellState {
  /** Build whose shell navigations get; unset until one is fully cached. */
  current?: string | undefined;
  /** The build before it, kept for tabs still running it and for offline. */
  previous?: string | undefined;
  workerCheckedAt?: number;
}

interface ShellBuildRecord extends ShellBuildFile {
  installedAt: number;
  /** Routes whose HTML turned out to depend on the URL in this build. */
  varyingRoutes: string[];
}

const STATE_PATH = "/__content-shell/state";
const BUILD_PATH_PREFIX = "/__content-shell/build/";
const PAGE_PATH_PREFIX = "/__content-shell/page/";
const PAGE_SOURCE_HEADER = "x-content-shell-source";
const PAGE_STORED_AT_HEADER = "x-content-shell-stored-at";
const PRECACHE_CONCURRENCY = 6;
// How often the worker asks whether the deploy still ships it. A deploy
// without `/sw.js` answers 404, and browsers keep a worker whose script
// disappeared, so the worker has to notice and remove itself.
const WORKER_CHECK_INTERVAL_MS = 60 * 60_000;
// Framework endpoints, such as auth callbacks, always reach the network.
const FRAMEWORK_PATH = /(^|\/)_agent-native(\/|$)/;
// Chunk recovery (`/__agent-native-chunk-recovery`, `?__agentNativeChunkRecovery`)
// and the build cache buster (`?__an_build`) mark a page that found its build
// out of date.
const STALE_BUILD_PATH = /(^|\/)__agent-native-[^/]*(\/|$)/;
const STALE_BUILD_QUERY_PREFIXES = ["__agentNative", "__an_"];
const FILE_PATH = /\/[^/]+\.[A-Za-z0-9]+$/;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function isBuildRecord(value: unknown): value is ShellBuildRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ShellBuildRecord>;
  return (
    typeof record.version === "string" &&
    Array.isArray(record.boot) &&
    Array.isArray(record.assets) &&
    Array.isArray(record.routes) &&
    Array.isArray(record.varyingRoutes)
  );
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isRouteList(value: unknown): value is ShellRoute[] {
  return (
    Array.isArray(value) &&
    value.every(
      (route) =>
        route &&
        typeof route === "object" &&
        typeof route.id === "string" &&
        typeof route.pattern === "string" &&
        typeof route.app === "boolean",
    )
  );
}

export function parseShellBuildFile(
  value: unknown,
  version: string,
): ShellBuildFile {
  const file = (value ?? {}) as Partial<ShellBuildFile>;
  if (
    file.version !== version ||
    !isStringList(file.boot) ||
    !isStringList(file.assets) ||
    !isRouteList(file.routes)
  ) {
    throw new Error(`Shell build file for ${version} is malformed`);
  }
  return {
    version,
    boot: file.boot.filter((path) => IMMUTABLE_ASSET_PATH.test(path)),
    assets: file.assets.filter((path) => IMMUTABLE_ASSET_PATH.test(path)),
    routes: file.routes,
  };
}

export interface ShellStaticRoute {
  condition: { urlPattern: string; requestMethod?: string };
  source: "network" | { cacheName: string };
}

/**
 * Requests the browser answers without running the worker (Service Worker
 * Static Routing, Chrome 123+). A page boots hundreds of build files, and
 * passing each through the fetch handler costs more than the cache lookup
 * itself. Build files come from the worker's file cache, and from the network
 * when it lacks one; framework requests go straight to the network. Browsers
 * without the API send both through `handleFetch`, which does the same.
 */
export function shellStaticRoutes(): ShellStaticRoute[] {
  return [
    {
      condition: { urlPattern: "/assets/*", requestMethod: "GET" },
      source: { cacheName: SHELL_CACHE_NAMES.assets },
    },
    { condition: { urlPattern: "/_agent-native/*" }, source: "network" },
  ];
}

/**
 * A navigation from a page that found its build out of date. It goes to the
 * network, and the worker stops serving that build from cache.
 */
export function isStaleBuildNavigation(url: URL): boolean {
  if (STALE_BUILD_PATH.test(url.pathname)) return true;
  for (const key of url.searchParams.keys()) {
    if (STALE_BUILD_QUERY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

/** The page a stale-build navigation asks for, as the server renders it. */
function withoutStaleBuildMarkers(url: URL): URL {
  const page = new URL(url.href);
  page.pathname =
    page.pathname
      .split("/")
      .filter((segment) => !STALE_BUILD_PATH.test(`/${segment}`))
      .join("/") || "/";
  for (const key of [...page.searchParams.keys()]) {
    if (STALE_BUILD_QUERY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      page.searchParams.delete(key);
    }
  }
  return page;
}

/**
 * How long the server lets a browser cache reuse this HTML: max-age plus
 * stale-while-revalidate. A kept shell is never used first for longer, so a
 * returning visitor never boots an older build than their HTTP cache could.
 */
function reuseWindowMs(page: Response): number {
  let seconds = 0;
  for (const directive of (page.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")) {
    const [name, value] = directive.trim().split("=");
    if (name !== "max-age" && name !== "stale-while-revalidate") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) seconds += parsed;
  }
  return seconds * 1000;
}

function reportWorkerError(error: unknown): void {
  console.warn("[content-shell] background update failed", error);
}

async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  // The workers share one iterator, so each item is taken once.
  const queue = items.values();
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (const item of queue) await task(item);
    },
  );
  await Promise.all(workers);
}

export function createShellWorker(env: ShellWorkerEnvironment) {
  const { origin } = env;
  let statePromise: Promise<ShellState> | undefined;
  const builds = new Map<string, ShellBuildRecord>();
  const buildFiles = new Map<string, Promise<ShellBuildFile>>();
  const installs = new Map<string, Promise<ShellBuildRecord>>();
  // An unregistered worker keeps serving the tabs it controls until they
  // navigate, and must not refill the caches it just deleted.
  let removed = false;

  const absolute = (path: string) => new URL(path, origin).href;
  const openCache = (name: string) => env.caches.open(name);

  async function readState(): Promise<ShellState> {
    statePromise ??= (async () => {
      const cache = await openCache(SHELL_CACHE_NAMES.state);
      const stored = await cache.match(absolute(STATE_PATH));
      return stored ? ((await stored.json()) as ShellState) : {};
    })();
    return statePromise;
  }

  async function writeState(state: ShellState): Promise<void> {
    statePromise = Promise.resolve(state);
    const cache = await openCache(SHELL_CACHE_NAMES.state);
    await cache.put(absolute(STATE_PATH), jsonResponse(state));
  }

  async function readBuild(
    version: string | undefined,
  ): Promise<ShellBuildRecord | undefined> {
    if (!version) return undefined;
    const known = builds.get(version);
    if (known) return known;
    const cache = await openCache(SHELL_CACHE_NAMES.state);
    const stored = await cache.match(
      absolute(`${BUILD_PATH_PREFIX}${version}`),
    );
    if (!stored) return undefined;
    const record: unknown = await stored.json();
    if (!isBuildRecord(record)) return undefined;
    builds.set(version, record);
    return record;
  }

  async function writeBuild(record: ShellBuildRecord): Promise<void> {
    builds.set(record.version, record);
    const cache = await openCache(SHELL_CACHE_NAMES.state);
    await cache.put(
      absolute(`${BUILD_PATH_PREFIX}${record.version}`),
      jsonResponse(record),
    );
  }

  function pageKey(
    build: ShellBuildRecord,
    route: ShellRoute,
    url: URL,
  ): string {
    const key = build.varyingRoutes.includes(route.id)
      ? `path:${url.pathname}`
      : `route:${route.id}`;
    return absolute(
      `${PAGE_PATH_PREFIX}${build.version}/${encodeURIComponent(key)}`,
    );
  }

  async function cachedPage(
    build: ShellBuildRecord | undefined,
    url: URL,
  ): Promise<Response | undefined> {
    if (!build) return undefined;
    const route = matchShellRoute(url.pathname, build.routes);
    if (!route?.app) return undefined;
    const pages = await openCache(SHELL_CACHE_NAMES.pages);
    return pages.match(pageKey(build, route, url));
  }

  async function precache(paths: readonly string[]): Promise<void> {
    const cache = await openCache(SHELL_CACHE_NAMES.assets);
    const cached = new Set(
      (await cache.keys()).map((request) => new URL(request.url).pathname),
    );
    const missing = paths.filter((path) => !cached.has(path));
    await runPool(missing, PRECACHE_CONCURRENCY, async (path) => {
      const response = await env.fetch(absolute(path), {
        credentials: "same-origin",
      });
      if (response.status !== 200) {
        throw new Error(`${path} answered ${response.status}`);
      }
      await cache.put(absolute(path), response);
    });
  }

  async function fetchBuildFile(version: string): Promise<ShellBuildFile> {
    let pending = buildFiles.get(version);
    if (!pending) {
      pending = (async () => {
        const response = await env.fetch(
          absolute(shellBuildFilePath(version)),
          { credentials: "same-origin" },
        );
        if (response.status !== 200) {
          throw new Error(
            `Shell build file for ${version} answered ${response.status}`,
          );
        }
        return parseShellBuildFile(await response.json(), version);
      })();
      pending.catch(() => buildFiles.delete(version));
      buildFiles.set(version, pending);
    }
    return pending;
  }

  async function installBuild(
    file: ShellBuildFile,
    html: string,
  ): Promise<ShellBuildRecord> {
    // The build file lists the boot set; the HTML's own preloads are added in
    // case a build ever loads more than React Router's manifest names.
    const boot = [...new Set([...file.boot, ...shellAssetReferences(html)])];
    await precache(boot);
    const record: ShellBuildRecord = {
      ...file,
      boot,
      installedAt: env.now(),
      varyingRoutes: [],
    };
    await writeBuild(record);
    return record;
  }

  /**
   * The build's record once all its boot files are cached, or nothing when
   * the URL isn't an app route: a visit to a public page never downloads the
   * app.
   */
  async function ensureBuild(
    version: string,
    html: string,
    url: URL,
  ): Promise<ShellBuildRecord | undefined> {
    const existing = await readBuild(version);
    if (existing) return existing;
    const file = await fetchBuildFile(version);
    if (!matchShellRoute(url.pathname, file.routes)?.app) return undefined;
    let pending = installs.get(version);
    if (!pending) {
      pending = installBuild(file, html).finally(() =>
        installs.delete(version),
      );
      installs.set(version, pending);
    }
    return pending;
  }

  async function storePage(
    build: ShellBuildRecord,
    route: ShellRoute,
    url: URL,
    html: string,
    response: Response,
  ): Promise<void> {
    const pages = await openCache(SHELL_CACHE_NAMES.pages);
    const headers = new Headers(response.headers);
    headers.set(PAGE_SOURCE_HEADER, url.pathname);
    headers.set(PAGE_STORED_AT_HEADER, String(env.now()));
    const page = () =>
      new Response(html, {
        status: 200,
        statusText: response.statusText,
        headers,
      });
    const key = pageKey(build, route, url);
    if (!build.varyingRoutes.includes(route.id)) {
      // Every URL of a route shares one shell while their HTML matches. Two
      // URLs answering differently in one build mean the HTML depends on the
      // URL, so from then on each URL keeps its own copy.
      const shared = await pages.match(key);
      if (
        shared &&
        shared.headers.get(PAGE_SOURCE_HEADER) !== url.pathname &&
        (await shared.text()) !== html
      ) {
        await pages.delete(key);
        const record = {
          ...build,
          varyingRoutes: [...build.varyingRoutes, route.id],
        };
        await writeBuild(record);
        await pages.put(pageKey(record, route, url), page());
        return;
      }
    }
    await pages.put(key, page());
  }

  async function prune(state: ShellState): Promise<void> {
    const keep = new Set(
      [state.current, state.previous].filter((version): version is string =>
        Boolean(version),
      ),
    );
    const stateCache = await openCache(SHELL_CACHE_NAMES.state);
    const kept: ShellBuildRecord[] = [];
    for (const request of await stateCache.keys()) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith(BUILD_PATH_PREFIX)) continue;
      const version = pathname.slice(BUILD_PATH_PREFIX.length);
      if (keep.has(version)) {
        const record = await readBuild(version);
        if (record) kept.push(record);
        continue;
      }
      builds.delete(version);
      await stateCache.delete(request);
    }

    const pages = await openCache(SHELL_CACHE_NAMES.pages);
    for (const request of await pages.keys()) {
      const version = new URL(request.url).pathname
        .slice(PAGE_PATH_PREFIX.length)
        .split("/", 1)
        .join("");
      if (!keep.has(version)) await pages.delete(request);
    }

    const needed = new Set(
      kept.flatMap((record) => [...record.boot, ...record.assets]),
    );
    const assets = await openCache(SHELL_CACHE_NAMES.assets);
    for (const request of await assets.keys()) {
      if (!needed.has(new URL(request.url).pathname)) {
        await assets.delete(request);
      }
    }
  }

  async function promote(version: string): Promise<void> {
    const state = await readState();
    if (state.current === version) return;
    const next: ShellState = {
      ...state,
      current: version,
      previous: state.current ?? state.previous,
    };
    await writeState(next);
    await prune(next);
  }

  /** The page found its build out of date: go to the network until a newer build is cached. */
  async function stepDown(): Promise<void> {
    const state = await readState();
    if (!state.current) return;
    await writeState({
      ...state,
      current: undefined,
      previous: state.current,
    });
  }

  async function removeWorker(): Promise<void> {
    removed = true;
    await deleteShellCaches(env.caches);
    statePromise = undefined;
    builds.clear();
    await env.unregister();
  }

  async function checkWorkerShipped(): Promise<void> {
    const state = await readState();
    if (
      state.workerCheckedAt !== undefined &&
      env.now() - state.workerCheckedAt < WORKER_CHECK_INTERVAL_MS
    ) {
      return;
    }
    await writeState({ ...state, workerCheckedAt: env.now() });
    // The query keeps a CDN that ignores no-store from answering with a copy.
    const response = await env.fetch(
      absolute(`${SHELL_WORKER_URL}?shell-check=${env.now()}`),
      { cache: "no-store", credentials: "omit" },
    );
    if (response.status === 404 || response.status === 410) {
      await removeWorker();
    }
  }

  /** The server's own answer for a page, past the browser's HTTP cache and without cookies. */
  function fetchFromServer(url: URL): Promise<Response> {
    return env.fetch(url.href, {
      cache: "no-cache",
      credentials: "omit",
      headers: { accept: "text/html" },
    });
  }

  async function updateFrom(
    url: URL,
    response: Response,
    fromServer: boolean,
  ): Promise<void> {
    if (!isShareableShellResponse(response)) return;
    const html = await response.text();
    const version = shellBuildVersion(html);
    if (!version || !isShellBuildVersion(version)) return;
    if (!fromServer && version !== (await readState()).current) {
      // A navigation's answer can come from the browser's HTTP cache, which
      // keeps the HTML of the build before a deploy for its max-age. Only the
      // server's own answer may switch builds, or the worker would switch
      // back after every deploy.
      await updateFrom(url, await fetchFromServer(url), true);
      return;
    }
    const build = await ensureBuild(version, html, url);
    const route = build && matchShellRoute(url.pathname, build.routes);
    if (build && route?.app) {
      await storePage(build, route, url, html, response);
      await promote(version);
    }
  }

  /** Bring the kept shell up to date from a page's answer. */
  async function revalidate(
    url: URL,
    response: Response,
    fromServer = false,
  ): Promise<void> {
    try {
      await updateFrom(url, response, fromServer);
    } finally {
      // Awaited inside the event's waitUntil, so the browser can't stop the
      // worker halfway through removing itself. A build whose file is
      // missing usually means a deploy without the worker.
      await checkWorkerShipped();
    }
  }

  function isReusable(page: Response): boolean {
    const storedAt = Number(page.headers.get(PAGE_STORED_AT_HEADER));
    return (
      Number.isFinite(storedAt) && env.now() - storedAt <= reuseWindowMs(page)
    );
  }

  function networkResponse(event: ShellFetchEvent): Promise<Response> {
    const preload = event.preloadResponse;
    if (!preload) return env.fetch(event.request);
    return preload.then((response) => response ?? env.fetch(event.request));
  }

  async function serveNavigation(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    const network = networkResponse(event);
    const state = await readState();
    const current = await readBuild(state.current);
    let cached: Response | undefined;
    if (current) {
      const route = matchShellRoute(url.pathname, current.routes);
      if (!route?.app) return network;
      cached = await cachedPage(current, url);
      if (cached && isReusable(cached)) {
        event.waitUntil(
          network
            .then((response) => revalidate(url, response))
            .catch(reportWorkerError),
        );
        return cached;
      }
    }
    let response: Response;
    try {
      response = await network;
    } catch (error) {
      // Offline, a kept shell boots however old it is, or else the previous
      // build's, since the files of both are kept.
      const fallback =
        cached ?? (await cachedPage(await readBuild(state.previous), url));
      if (fallback) return fallback;
      throw error;
    }
    event.waitUntil(revalidate(url, response.clone()).catch(reportWorkerError));
    return response;
  }

  /**
   * The page found its build out of date, so the network answers. Offline,
   * a kept shell of the same page still boots; recovery's own cooldown stops
   * it reloading again if a file is still missing.
   */
  async function serveStaleNavigation(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    const state = await readState();
    event.waitUntil(stepDown().catch(reportWorkerError));
    try {
      return await networkResponse(event);
    } catch (error) {
      const page = withoutStaleBuildMarkers(url);
      for (const version of [state.current, state.previous]) {
        const fallback = await cachedPage(await readBuild(version), page);
        if (fallback) return fallback;
      }
      throw error;
    }
  }

  async function serveAsset(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    // Files are kept only while the worker's state is: after the worker
    // removed itself, a restarted copy still serving an old tab stores
    // nothing. (The file cache itself is no sign: Chrome can bring it back
    // empty after it's deleted.)
    if (!(await env.caches.has(SHELL_CACHE_NAMES.state))) {
      return env.fetch(event.request);
    }
    const cache = await openCache(SHELL_CACHE_NAMES.assets);
    const key = absolute(url.pathname);
    const cached = await cache.match(key);
    if (cached) return cached;
    const response = await env.fetch(event.request);
    if (
      response.status === 200 &&
      (response.type === "basic" || response.type === "default")
    ) {
      event.waitUntil(
        cache.put(key, response.clone()).catch(reportWorkerError),
      );
    }
    return response;
  }

  function handleFetch(event: ShellFetchEvent): void {
    const { request } = event;
    if (removed || request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== origin) return;
    if (request.mode === "navigate") {
      // Frames keep going to the network; only top-level pages get a shell.
      if (request.destination !== "document") return;
      if (isStaleBuildNavigation(url)) {
        event.respondWith(serveStaleNavigation(event, url));
        return;
      }
      if (FRAMEWORK_PATH.test(url.pathname) || FILE_PATH.test(url.pathname)) {
        return;
      }
      event.respondWith(serveNavigation(event, url));
      return;
    }
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
      return;
    }
    if (
      IMMUTABLE_ASSET_PATH.test(url.pathname) &&
      !request.headers.has("range")
    ) {
      event.respondWith(serveAsset(event, url));
    }
  }

  async function adopt(rawUrl: string): Promise<void> {
    const url = new URL(rawUrl, origin);
    if (
      removed ||
      url.origin !== origin ||
      FRAMEWORK_PATH.test(url.pathname) ||
      isStaleBuildNavigation(url)
    ) {
      return;
    }
    await revalidate(url, await fetchFromServer(url), true);
  }

  async function activate(): Promise<void> {
    const names = await env.caches.keys();
    const current = new Set<string>(Object.values(SHELL_CACHE_NAMES));
    await Promise.all(
      names
        .filter(
          (name) => name.startsWith(SHELL_CACHE_PREFIX) && !current.has(name),
        )
        .map((name) => env.caches.delete(name)),
    );
  }

  return {
    activate,
    adopt,
    handleFetch,
    readState,
    checkWorkerShipped,
  };
}
