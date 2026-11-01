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
 * new build and the open one never changes under the user. The rest of the
 * current build's files follow in the background. The current build, the one
 * before it and the build of every open tab keep their files, so a tab still
 * running an older build can load its lazy chunks.
 */

export interface ShellWorkerEnvironment {
  origin: string;
  caches: CacheStorage;
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  now(): number;
  unregister(): Promise<boolean>;
  /** Ids of the browser's open tabs on this origin. */
  clientIds(): Promise<string[]>;
  /** The browser's preferred languages, from which it writes Accept-Language. */
  languages(): readonly string[];
}

export interface ShellFetchEvent {
  readonly request: Request;
  readonly preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

/** A tab, and the build it said it runs. */
export interface ShellClient {
  id: string;
  version: string;
}

interface ShellClientBuild {
  version: string;
  reportedAt: number;
}

interface ShellState {
  /** Build whose shell navigations get; unset until one is fully cached. */
  current?: string | undefined;
  /** The build before it, kept for tabs still running it and for offline. */
  previous?: string | undefined;
  workerCheckedAt?: number;
  /** The build each open tab runs, by client id, as the tab last reported it. */
  clients?: Record<string, ShellClientBuild> | undefined;
}

interface ShellBuildRecord extends ShellBuildFile {
  installedAt: number;
  /** Routes whose HTML turned out to depend on the URL in this build. */
  varyingRoutes: string[];
  /** Whether every one of `assets` is cached, not just the boot files. */
  assetsCached?: boolean | undefined;
}

/** One answer for a page, numbered in the order the answers arrived. */
interface ShellAnswer {
  number: number;
  url: URL;
  route: ShellRoute;
  html: string;
  response: Response;
}

const STATE_PATH = "/__content-shell/state";
const BUILD_PATH_PREFIX = "/__content-shell/build/";
const PAGE_PATH_PREFIX = "/__content-shell/page/";
// `<prefix><version>/<language list>/<key>`, as `pageKey` writes it.
const PAGE_KEY_PATH = /^\/__content-shell\/page\/([^/]+)\/[^/]+\/([^/]+)$/;
const PAGE_SOURCE_HEADER = "x-content-shell-source";
const PAGE_RENDERED_AT_HEADER = "x-content-shell-rendered-at";
const PRECACHE_CONCURRENCY = 6;
// The rest of a build's files download behind the app's own requests.
const BACKGROUND_PRECACHE_CONCURRENCY = 2;
// How long a tab keeps its build's files after it last reported the build.
// Tabs report when they load and when they're shown again.
const CLIENT_BUILD_TTL_MS = 24 * 60 * 60_000;
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
 *
 * A file the route fetches from the network never reaches the worker, so it
 * isn't kept: the worker downloads the current build's every file itself,
 * lazy chunks included, behind the page.
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

/**
 * How old the server's copy already was when the worker got it: the `Age` a
 * CDN reports, or the time since the server's `Date` for a copy the browser's
 * HTTP cache kept.
 */
function responseAgeMs(response: Response, now: number): number {
  const age = Number(response.headers.get("age"));
  const date = Date.parse(response.headers.get("date") ?? "");
  return Math.max(
    0,
    Number.isFinite(age) ? age * 1000 : 0,
    Number.isFinite(date) ? now - date : 0,
  );
}

/** A plain 200 HTML page, whatever caching it allows. */
function isHtmlPage(response: Response): boolean {
  return (
    response.status === 200 &&
    !response.redirected &&
    (response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("text/html")
  );
}

function reportWorkerError(error: unknown): void {
  console.warn("[content-shell] background update failed", error);
}

/**
 * Runs `task` over `items`, `limit` at a time. After a failure no new item
 * starts, and it rejects only once the running ones have finished, so nothing
 * still writes to the cache when the caller cleans up.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  // The workers share one iterator, so each item is taken once.
  const queue = items.values();
  const failures: unknown[] = [];
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (const item of queue) {
        if (failures.length > 0) return;
        try {
          await task(item);
        } catch (error) {
          failures.push(error);
        }
      }
    },
  );
  await Promise.all(workers);
  if (failures.length > 0) throw failures[0];
}

interface PageKey {
  version: string;
  /** `route:<route id>` for a route's shared shell, `path:<pathname>` for one URL's. */
  key: string;
}

function parsePageKey(href: string): PageKey | undefined {
  const [, version, key] = PAGE_KEY_PATH.exec(new URL(href).pathname) ?? [];
  if (!version || !key) return undefined;
  return { version, key: decodeURIComponent(key) };
}

export function createShellWorker(env: ShellWorkerEnvironment) {
  const { origin } = env;
  let statePromise: Promise<ShellState> | undefined;
  const builds = new Map<string, ShellBuildRecord>();
  const buildFiles = new Map<string, Promise<ShellBuildFile>>();
  const downloads = new Map<string, Promise<void>>();
  const filling = new Set<string>();
  // Files a download in progress is storing. Prune leaves them alone until
  // their build is kept or the download is given up.
  const holds = new Set<ReadonlySet<string>>();
  // Answers are numbered as they arrive. A build whose download finishes
  // after a newer answer made another build current never replaces it.
  let answers = 0;
  let promotedAnswer = 0;
  // An unregistered worker keeps serving the tabs it controls until they
  // navigate, and must not refill the caches it just deleted.
  let removed = false;

  const absolute = (path: string) => new URL(path, origin).href;
  const openCache = (name: string) => env.caches.open(name);

  // Every change to which builds are kept (publishing, stepping down,
  // pruning, recording tabs, removal) runs one at a time. A task must not
  // call `exclusive` itself.
  let lock: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = lock.then(task);
    // coercion-ok: the caller gets the failure through `run`; the lock only
    // waits for the task to finish.
    lock = run.catch(() => undefined);
    return run;
  }

  function readState(): Promise<ShellState> {
    if (!statePromise) {
      const pending = (async (): Promise<ShellState> => {
        // Reading never creates the state: a worker that removed itself and
        // was started again must not look installed.
        if (!(await env.caches.has(SHELL_CACHE_NAMES.state))) return {};
        const cache = await openCache(SHELL_CACHE_NAMES.state);
        const stored = await cache.match(absolute(STATE_PATH));
        return stored ? ((await stored.json()) as ShellState) : {};
      })();
      statePromise = pending;
      // A failed read is tried again next time instead of failing every
      // later navigation.
      pending.catch(() => {
        if (statePromise === pending) statePromise = undefined;
      });
    }
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
    if (!(await env.caches.has(SHELL_CACHE_NAMES.state))) return undefined;
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
    // The server renders the shell in the language the browser's
    // Accept-Language asks for, so each language list keeps its own.
    const language = env.languages().join(",") || "*";
    return absolute(
      `${PAGE_PATH_PREFIX}${build.version}/${encodeURIComponent(language)}/${encodeURIComponent(key)}`,
    );
  }

  /** The route a kept page belongs to. */
  function pageRouteId(
    build: ShellBuildRecord,
    { key }: PageKey,
  ): string | undefined {
    if (key.startsWith("route:")) return key.slice("route:".length);
    return matchShellRoute(key.slice("path:".length), build.routes)?.id;
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

  /**
   * Downloads the files of `paths` the cache lacks. The first failure stops
   * it, unless `skipFailures`; it resolves to the number of files it skipped.
   */
  async function precache(
    paths: readonly string[],
    concurrency: number,
    skipFailures = false,
  ): Promise<number> {
    const cache = await openCache(SHELL_CACHE_NAMES.assets);
    const cached = new Set(
      (await cache.keys()).map((request) => new URL(request.url).pathname),
    );
    const missing = paths.filter((path) => !cached.has(path));
    let skipped = 0;
    await runPool(missing, concurrency, async (path) => {
      if (removed) throw new Error("The shell worker removed itself");
      try {
        const response = await env.fetch(absolute(path), {
          credentials: "same-origin",
        });
        if (response.status !== 200) {
          throw new Error(`${path} answered ${response.status}`);
        }
        await cache.put(absolute(path), response);
      } catch (error) {
        if (!skipFailures) throw error;
        skipped += 1;
      }
    });
    return skipped;
  }

  /** One download per build, however many navigations want it. */
  function downloadBoot(record: ShellBuildRecord): Promise<void> {
    let pending = downloads.get(record.version);
    if (!pending) {
      pending = precache(record.boot, PRECACHE_CONCURRENCY)
        .then(() => undefined)
        .finally(() => downloads.delete(record.version));
      downloads.set(record.version, pending);
    }
    return pending;
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

  /**
   * Runs a download of `paths` while prune leaves them alone. When the
   * download fails, or its build isn't kept by the end, whatever it stored
   * that no kept build lists is deleted, so failed deploys don't fill the
   * cache.
   */
  async function holding(
    paths: readonly string[],
    download: () => Promise<boolean>,
  ): Promise<void> {
    const hold: ReadonlySet<string> = new Set(paths);
    holds.add(hold);
    let kept = false;
    try {
      kept = await download();
    } finally {
      holds.delete(hold);
      if (!kept) {
        await exclusive(async () => {
          if (!removed) await prune(await readState());
        }).catch(reportWorkerError);
      }
    }
  }

  async function storePage(
    build: ShellBuildRecord,
    { url, route, html, response }: ShellAnswer,
  ): Promise<void> {
    const pages = await openCache(SHELL_CACHE_NAMES.pages);
    const headers = new Headers(response.headers);
    headers.set(PAGE_SOURCE_HEADER, url.pathname);
    const now = env.now();
    headers.set(
      PAGE_RENDERED_AT_HEADER,
      String(now - responseAgeMs(response, now)),
    );
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
      const source = shared?.headers.get(PAGE_SOURCE_HEADER);
      if (
        shared &&
        source !== url.pathname &&
        (await shared.clone().text()) !== html
      ) {
        await pages.delete(key);
        const record = {
          ...build,
          varyingRoutes: [...build.varyingRoutes, route.id],
        };
        await writeBuild(record);
        // The URL the shared copy came from keeps it as its own.
        if (source) {
          await pages.put(
            pageKey(record, route, new URL(source, origin)),
            shared,
          );
        }
        await pages.put(pageKey(record, route, url), page());
        return;
      }
    }
    await pages.put(key, page());
  }

  /** The open tabs' builds, without tabs that closed or went a day without reporting. */
  async function openClientBuilds(
    clients: Record<string, ShellClientBuild> | undefined,
  ): Promise<Record<string, ShellClientBuild>> {
    if (!clients) return {};
    let open: Set<string>;
    try {
      open = new Set(await env.clientIds());
    } catch (error) {
      // coercion-ok: without the list of open tabs every recent report counts
      // as open, which keeps more files, never fewer.
      reportWorkerError(error);
      open = new Set(Object.keys(clients));
    }
    const now = env.now();
    return Object.fromEntries(
      Object.entries(clients).filter(
        ([id, client]) =>
          open.has(id) && now - client.reportedAt < CLIENT_BUILD_TTL_MS,
      ),
    );
  }

  /**
   * Drops every build that isn't kept: the current one, the one before it
   * and the build of each open tab stay. Only the first two keep shells to
   * answer navigations with. Runs under `exclusive`.
   */
  async function prune(state: ShellState): Promise<void> {
    const clients = await openClientBuilds(state.clients);
    if (
      Object.keys(clients).length !== Object.keys(state.clients ?? {}).length
    ) {
      await writeState({ ...state, clients });
    }
    const shells = new Set(
      [state.current, state.previous].filter((version): version is string =>
        Boolean(version),
      ),
    );
    const keep = new Set([
      ...shells,
      ...Object.values(clients).map((client) => client.version),
    ]);
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
      const page = parsePageKey(request.url);
      if (!page || !shells.has(page.version)) await pages.delete(request);
    }

    const needed = new Set([
      ...kept.flatMap((record) => [...record.boot, ...record.assets]),
      ...[...holds].flatMap((hold) => [...hold]),
    ]);
    const assets = await openCache(SHELL_CACHE_NAMES.assets);
    for (const request of await assets.keys()) {
      if (!needed.has(new URL(request.url).pathname)) {
        await assets.delete(request);
      }
    }
  }

  async function requireCached(paths: readonly string[]): Promise<void> {
    const cache = await openCache(SHELL_CACHE_NAMES.assets);
    const cached = new Set(
      (await cache.keys()).map((request) => new URL(request.url).pathname),
    );
    const missing = paths.filter((path) => !cached.has(path));
    if (missing.length > 0) {
      throw new Error(`${missing.length} boot files went missing`);
    }
  }

  /**
   * Stores the page's shell and, when its build isn't current yet, makes it
   * current, after a last check that every boot file is still cached. An
   * answer older than the one that made the current build current never
   * switches. Resolves to whether the build is current.
   */
  function publish(
    record: ShellBuildRecord,
    answer: ShellAnswer,
  ): Promise<boolean> {
    return exclusive(async () => {
      if (removed) return false;
      const state = await readState();
      const promoting = record.version !== state.current;
      if (promoting) {
        if (answer.number < promotedAnswer) return false;
        await requireCached(record.boot);
      }
      const known = await readBuild(record.version);
      if (!known) await writeBuild(record);
      await storePage(known ?? record, answer);
      if (promoting) {
        promotedAnswer = answer.number;
        const next: ShellState = {
          ...state,
          current: record.version,
          previous: state.current ?? state.previous,
        };
        await writeState(next);
        await prune(next);
      }
      return true;
    });
  }

  /**
   * Downloads the rest of the current build's files, lazy chunks included, a
   * few at a time. Each navigation picks up where the last one stopped.
   */
  async function fillCurrentBuild(): Promise<void> {
    if (removed) return;
    const record = await readBuild((await readState()).current);
    if (!record || record.assetsCached || filling.has(record.version)) return;
    const { version, assets } = record;
    filling.add(version);
    try {
      await holding(assets, async () => {
        const skipped = await precache(
          assets,
          BACKGROUND_PRECACHE_CONCURRENCY,
          true,
        );
        return exclusive(async () => {
          const latest = await readBuild(version);
          if (!latest || removed) return false;
          if (skipped === 0)
            await writeBuild({ ...latest, assetsCached: true });
          return true;
        });
      });
    } finally {
      filling.delete(version);
    }
  }

  /**
   * The server no longer lets anyone share this route's HTML (SSR caching
   * turned off, say): delete its kept shells in every build, so the route
   * goes to the network until the server shares it again.
   */
  async function retirePages(url: URL): Promise<void> {
    await exclusive(async () => {
      if (removed || !(await env.caches.has(SHELL_CACHE_NAMES.pages))) return;
      const pages = await openCache(SHELL_CACHE_NAMES.pages);
      for (const request of await pages.keys()) {
        const page = parsePageKey(request.url);
        const build = page && (await readBuild(page.version));
        if (!page || !build) continue;
        const route = matchShellRoute(url.pathname, build.routes);
        if (route && pageRouteId(build, page) === route.id) {
          await pages.delete(request);
        }
      }
    });
  }

  /** The page found its build out of date: go to the network until a newer build is cached. */
  async function stepDown(): Promise<void> {
    await exclusive(async () => {
      const state = await readState();
      if (removed || !state.current) return;
      await writeState({
        ...state,
        current: undefined,
        previous: state.current,
      });
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
    const due = await exclusive(async () => {
      if (removed) return false;
      const state = await readState();
      if (
        state.workerCheckedAt !== undefined &&
        env.now() - state.workerCheckedAt < WORKER_CHECK_INTERVAL_MS
      ) {
        return false;
      }
      await writeState({ ...state, workerCheckedAt: env.now() });
      return true;
    });
    if (!due) return;
    // The query keeps a CDN that ignores no-store from answering with a copy.
    const response = await env.fetch(
      absolute(`${SHELL_WORKER_URL}?shell-check=${env.now()}`),
      { cache: "no-store", credentials: "omit" },
    );
    // A host whose catch-all route renders unknown paths answers with the
    // app's HTML instead of a 404.
    if (
      response.status === 404 ||
      response.status === 410 ||
      isHtmlPage(response)
    ) {
      await exclusive(removeWorker);
    }
  }

  /** A tab reported the build it runs; that build's files stay while the tab is open. */
  async function noteClient(clientId: string, version: string): Promise<void> {
    if (!clientId || !isShellBuildVersion(version)) return;
    await exclusive(async () => {
      // A restarted copy of a worker that removed itself must not bring its
      // state back.
      if (removed || !(await env.caches.has(SHELL_CACHE_NAMES.state))) return;
      const state = await readState();
      const clients = await openClientBuilds(state.clients);
      clients[clientId] = { version, reportedAt: env.now() };
      await writeState({ ...state, clients });
    });
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
    if (!isShareableShellResponse(response)) {
      if (isHtmlPage(response)) await retirePages(url);
      return;
    }
    const number = (answers += 1);
    const html = await response.text();
    const version = shellBuildVersion(html);
    if (!version || !isShellBuildVersion(version)) return;
    const state = await readState();
    if (!fromServer && version !== state.current) {
      // A navigation's answer can come from the browser's HTTP cache, which
      // keeps the HTML of the build before a deploy for its max-age. Only the
      // server's own answer may switch builds, or the worker would switch
      // back after every deploy.
      await updateFrom(url, await fetchFromServer(url), true);
      return;
    }
    const known = await readBuild(version);
    const file = known ?? (await fetchBuildFile(version));
    // A visit to a public page never downloads the app.
    const route = matchShellRoute(url.pathname, file.routes);
    if (!route?.app) return;
    const answer: ShellAnswer = { number, url, route, html, response };
    if (known && version === state.current) {
      await publish(known, answer);
      return;
    }
    const record: ShellBuildRecord = known ?? {
      ...file,
      // The build file lists the boot set; the HTML's own preloads are added
      // in case a build ever loads more than React Router's manifest names.
      boot: [...new Set([...file.boot, ...shellAssetReferences(html)])],
      installedAt: env.now(),
      varyingRoutes: [],
    };
    await holding(record.boot, async () => {
      await downloadBoot(record);
      return publish(record, answer);
    });
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
    await fillCurrentBuild();
  }

  function isReusable(page: Response): boolean {
    const renderedAt = Number(page.headers.get(PAGE_RENDERED_AT_HEADER));
    return (
      Number.isFinite(renderedAt) &&
      env.now() - renderedAt <= reuseWindowMs(page)
    );
  }

  function networkResponse(event: ShellFetchEvent): Promise<Response> {
    const preload = event.preloadResponse;
    if (!preload) return env.fetch(event.request);
    return preload.then((response) => response ?? env.fetch(event.request));
  }

  /** A kept shell for the offline path; a storage failure there leaves the network's error to report. */
  async function offlineShell(
    versions: (string | undefined)[],
    url: URL,
  ): Promise<Response | undefined> {
    try {
      for (const version of versions) {
        const page = await cachedPage(await readBuild(version), url);
        if (page) return page;
      }
    } catch (error) {
      // coercion-ok: the network already failed; the caller reports that.
      reportWorkerError(error);
    }
    return undefined;
  }

  async function serveNavigation(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    const network = networkResponse(event);
    let state: ShellState = {};
    let cached: Response | undefined;
    try {
      state = await readState();
      const current = await readBuild(state.current);
      if (current) {
        const route = matchShellRoute(url.pathname, current.routes);
        if (!route?.app) return network;
        cached = await cachedPage(current, url);
      }
    } catch (error) {
      // coercion-ok: a kept shell only saves the round trip, so when the
      // cache can't be read the network answers, as it would without the
      // worker.
      reportWorkerError(error);
      return network;
    }
    if (cached && isReusable(cached)) {
      event.waitUntil(
        network
          .then((response) => revalidate(url, response))
          .catch(reportWorkerError),
      );
      return cached;
    }
    let response: Response;
    try {
      response = await network;
    } catch (error) {
      // Offline, a kept shell boots however old it is, or else the previous
      // build's, since the files of both are kept.
      const fallback = cached ?? (await offlineShell([state.previous], url));
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
    const state = await readState().catch((error: unknown): ShellState => {
      // coercion-ok: without the state there's no kept shell to fall back
      // on; the network still answers.
      reportWorkerError(error);
      return {};
    });
    event.waitUntil(stepDown().catch(reportWorkerError));
    try {
      return await networkResponse(event);
    } catch (error) {
      const fallback = await offlineShell(
        [state.current, state.previous],
        withoutStaleBuildMarkers(url),
      );
      if (fallback) return fallback;
      throw error;
    }
  }

  async function serveAsset(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    const key = absolute(url.pathname);
    let cache: Cache | undefined;
    try {
      // Files are kept only while the worker's state is: after the worker
      // removed itself, a restarted copy still serving an old tab stores
      // nothing. (The file cache itself is no sign: Chrome can bring it back
      // empty after it's deleted.)
      if (await env.caches.has(SHELL_CACHE_NAMES.state)) {
        cache = await openCache(SHELL_CACHE_NAMES.assets);
        const cached = await cache.match(key);
        if (cached) return cached;
      }
    } catch (error) {
      // coercion-ok: the network has the same file; a storage failure only
      // costs the round trip.
      reportWorkerError(error);
      cache = undefined;
    }
    const response = await env.fetch(event.request);
    if (
      cache &&
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

  /** Cache the shell of a page the worker didn't serve, and note the build that tab runs. */
  async function adopt(rawUrl: string, client?: ShellClient): Promise<void> {
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
    if (client) await noteClient(client.id, client.version);
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
    noteClient,
    readState,
    checkWorkerShipped,
  };
}
