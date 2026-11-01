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
 * new build and the open one never changes under the user. Once a page has
 * loaded, the rest of the current build's files follow in the background.
 * The current build, the one before it and the build of every open tab keep
 * their files, so a tab still running an older build can load its lazy
 * chunks.
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
  /** Whether the browser asks sites to use less data (`navigator.connection.saveData`). */
  saveData(): boolean;
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
  /**
   * After a step-down, the build that was previous until then, kept while no
   * build is current: if the build stepped down from comes back, this one is
   * the build before it again.
   */
  beforePrevious?: string | undefined;
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
const PAGE_STORED_AT_HEADER = "x-content-shell-stored-at";
// Each page of a build keeps its shell in this many language lists, the ones
// used last.
const LANGUAGES_PER_PAGE = 2;
// The worker downloads build files behind the app's own requests, this many at
// a time across all its downloads.
const DOWNLOAD_SLOTS = 2;
// How long a tab's report of its build counts when the browser can't list
// its open tabs. Otherwise a tab keeps its build's files until it closes.
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
// The content type a build file's extension calls for. A host's catch-all
// route answers an unknown path with HTML and a 200, which must never be kept
// as one of the build's files.
const JAVASCRIPT_TYPE = /^(text|application)\/(x-)?(javascript|ecmascript)\b/;
const ASSET_CONTENT_TYPES: Partial<Record<string, RegExp>> = {
  js: JAVASCRIPT_TYPE,
  mjs: JAVASCRIPT_TYPE,
  css: /^text\/css\b/,
  json: /^application\/([\w.+-]+\+)?json\b/,
  wasm: /^application\/wasm\b/,
};

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

/** Whether a response is the build file `path` names, not a page answering in its place. */
function isAssetResponse(path: string, response: Response): boolean {
  if (response.status !== 200) return false;
  const type = (response.headers.get("content-type") ?? "")
    .trim()
    .toLowerCase();
  if (type.includes("text/html")) return false;
  const extension = /\.([a-z0-9]+)$/.exec(path)?.[1] ?? "";
  return ASSET_CONTENT_TYPES[extension]?.test(type) ?? true;
}

function reportWorkerError(error: unknown): void {
  // A download stopped because a newer build made it useless isn't a failure.
  if (error instanceof DOMException && error.name === "AbortError") return;
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

interface DownloadOptions {
  /** Skip files that fail instead of stopping at the first. */
  skipFailures?: boolean;
  /** Wait while any build's boot files download, so they get the slots first. */
  behindBoot?: boolean;
  /** Stops the download: no new file starts and running ones are aborted. */
  signal: AbortSignal;
}

/** A download of one build's files, stopped once nothing will use that build. */
interface Download {
  version: string;
  /** The newest answer waiting on it. */
  answer: number;
  controller: AbortController;
  done: Promise<void>;
}

export function createShellWorker(env: ShellWorkerEnvironment) {
  const { origin } = env;
  let statePromise: Promise<ShellState> | undefined;
  const builds = new Map<string, ShellBuildRecord>();
  const buildFiles = new Map<string, Promise<ShellBuildFile>>();
  // Boot downloads, by build.
  const downloads = new Map<string, Download>();
  // Background downloads of the rest of a build's files, by build.
  const fills = new Map<string, Download>();
  // Build files downloading now, and downloads waiting for a slot.
  let downloading = 0;
  const waiting: Array<() => void> = [];
  // Whether the last navigation carried `Save-Data: on`.
  let saveDataNavigation = false;
  // Files a download in progress is storing. Prune leaves them alone until
  // their build is kept or the download is given up.
  const holds = new Set<ReadonlySet<string>>();
  // Answers are numbered as they arrive. A build whose download finishes
  // after a newer answer made another build current never replaces it.
  let answers = 0;
  let promotedAnswer = 0;
  // Answers still on their way to `publish`, and the pages the server
  // stopped sharing, with the answer that said so. An older answer never
  // stores a shell for such a page, nor makes its build current.
  const pendingAnswers = new Set<number>();
  const unshared = new Map<string, number>();
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

  // The in-memory copies follow a write only once it is stored, so a failed
  // write leaves the worker as Cache Storage has it.
  async function writeState(state: ShellState): Promise<void> {
    const cache = await openCache(SHELL_CACHE_NAMES.state);
    await cache.put(absolute(STATE_PATH), jsonResponse(state));
    statePromise = Promise.resolve(state);
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
    const cache = await openCache(SHELL_CACHE_NAMES.state);
    await cache.put(
      absolute(`${BUILD_PATH_PREFIX}${record.version}`),
      jsonResponse(record),
    );
    builds.set(record.version, record);
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

  /** Runs `task` in one of the worker's `DOWNLOAD_SLOTS`, waiting for one if need be. */
  async function inSlot<T>(task: () => Promise<T>): Promise<T> {
    if (downloading < DOWNLOAD_SLOTS) downloading += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // The slot passes straight to the next download waiting, if any.
      const next = waiting.shift();
      if (next) next();
      else downloading -= 1;
    }
  }

  /** Resolves once no build's boot files are downloading, or `signal` aborts. */
  async function bootFilesDone(signal: AbortSignal): Promise<void> {
    while (downloads.size > 0 && !signal.aborted) {
      await Promise.race([
        Promise.allSettled([...downloads.values()].map(({ done }) => done)),
        new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        ),
      ]);
    }
  }

  /**
   * Downloads the files of `paths` the cache lacks, at low priority, since
   * the page in front of the user never waits on them. The first failure
   * stops it, unless `skipFailures`; it resolves to the number of files it
   * skipped.
   */
  async function precache(
    paths: readonly string[],
    { skipFailures = false, behindBoot = false, signal }: DownloadOptions,
  ): Promise<number> {
    const cache = await openCache(SHELL_CACHE_NAMES.assets);
    const cached = new Set(
      (await cache.keys()).map((request) => new URL(request.url).pathname),
    );
    const missing = paths.filter((path) => !cached.has(path));
    let skipped = 0;
    await runPool(missing, DOWNLOAD_SLOTS, async (path) => {
      if (behindBoot) await bootFilesDone(signal);
      await inSlot(async () => {
        if (removed) throw new Error("The shell worker removed itself");
        signal.throwIfAborted();
        try {
          const response = await env.fetch(absolute(path), {
            credentials: "same-origin",
            priority: "low",
            signal,
          });
          if (!isAssetResponse(path, response)) {
            throw new Error(
              `${path} answered ${response.status} ${response.headers.get("content-type") ?? ""}`,
            );
          }
          await cache.put(absolute(path), response);
        } catch (error) {
          if (!skipFailures || signal.aborted) throw error;
          skipped += 1;
        }
      });
    });
    return skipped;
  }

  /**
   * One download per build, however many navigations want it. Fills wait
   * while it runs, so a new build's boot files get the slots first.
   */
  function downloadBoot(record: ShellBuildRecord, answer: number): Download {
    const running = downloads.get(record.version);
    if (running && !running.controller.signal.aborted) {
      running.answer = Math.max(running.answer, answer);
      return running;
    }
    const controller = new AbortController();
    const download: Download = {
      version: record.version,
      answer,
      controller,
      done: precache(record.boot, { signal: controller.signal })
        .then(() => undefined)
        .finally(() => {
          if (downloads.get(record.version) === download) {
            downloads.delete(record.version);
          }
        }),
    };
    downloads.set(record.version, download);
    return download;
  }

  /**
   * A build became current, or none is: boot downloads only an older answer
   * waits on can never be used, so they stop.
   */
  function stopOutdatedDownloads(current: string | undefined): void {
    for (const download of downloads.values()) {
      if (download.version !== current && download.answer < promotedAnswer) {
        download.controller.abort();
      }
    }
  }

  /** The builds fills download: the current one and every open tab's. */
  async function buildsInUse(state: ShellState): Promise<Set<string>> {
    const clients = await openClientBuilds(state.clients);
    return new Set(
      [
        state.current,
        ...Object.values(clients).map((client) => client.version),
      ].filter((version): version is string => Boolean(version)),
    );
  }

  /** Fills stop once their build is neither current nor open in a tab. */
  function stopUnusedFills(inUse: ReadonlySet<string>): void {
    for (const download of fills.values()) {
      if (!inUse.has(download.version)) download.controller.abort();
    }
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

  /**
   * Stores a page's shell and drops its copies in older language lists, so
   * each page of a build keeps the `LANGUAGES_PER_PAGE` used last. Every
   * navigation stores its page again, which is what marks it used.
   */
  async function putPage(
    pages: Cache,
    href: string,
    page: Response,
  ): Promise<void> {
    await pages.put(href, page);
    const stored = parsePageKey(href);
    if (!stored) return;
    const others: { request: Request; storedAt: number }[] = [];
    for (const request of await pages.keys()) {
      const other = parsePageKey(request.url);
      if (
        request.url === href ||
        other?.version !== stored.version ||
        other.key !== stored.key
      ) {
        continue;
      }
      const copy = await pages.match(request);
      others.push({
        request,
        storedAt: Number(copy?.headers.get(PAGE_STORED_AT_HEADER)) || 0,
      });
    }
    others.sort((first, second) => second.storedAt - first.storedAt);
    for (const { request } of others.slice(LANGUAGES_PER_PAGE - 1)) {
      await pages.delete(request);
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
    headers.set(PAGE_STORED_AT_HEADER, String(now));
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
          await putPage(
            pages,
            pageKey(record, route, new URL(source, origin)),
            shared,
          );
        }
        await putPage(pages, pageKey(record, route, url), page());
        return;
      }
    }
    await putPage(pages, key, page());
  }

  /**
   * The open tabs' builds, however long ago each tab reported, without the
   * tabs that closed.
   */
  async function openClientBuilds(
    clients: Record<string, ShellClientBuild> | undefined,
  ): Promise<Record<string, ShellClientBuild>> {
    if (!clients) return {};
    let isOpen: (id: string, client: ShellClientBuild) => boolean;
    try {
      const open = new Set(await env.clientIds());
      isOpen = (id) => open.has(id);
    } catch (error) {
      // coercion-ok: without the list of open tabs a tab's report counts for
      // a day, so a failed read keeps files rather than dropping them.
      reportWorkerError(error);
      const now = env.now();
      isOpen = (_id, client) => now - client.reportedAt < CLIENT_BUILD_TTL_MS;
    }
    return Object.fromEntries(
      Object.entries(clients).filter(([id, client]) => isOpen(id, client)),
    );
  }

  /**
   * Drops every build that isn't kept: the current one, the one before it
   * (after a step-down, the one before that too) and the build of each open
   * tab stay. Only the first ones keep shells. Runs under `exclusive`.
   */
  async function prune(state: ShellState): Promise<void> {
    const clients = await openClientBuilds(state.clients);
    if (
      Object.keys(clients).length !== Object.keys(state.clients ?? {}).length
    ) {
      await writeState({ ...state, clients });
    }
    const shells = new Set(
      [state.current, state.previous, state.beforePrevious].filter(
        (version): version is string => Boolean(version),
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

  /** Whether a newer answer said the server no longer shares this answer's page. */
  function unsharedSince(
    record: ShellBuildRecord,
    answer: ShellAnswer,
  ): boolean {
    for (const [pathname, number] of unshared) {
      if (
        number > answer.number &&
        matchShellRoute(pathname, record.routes)?.id === answer.route.id
      ) {
        return true;
      }
    }
    return false;
  }

  /** Forget retirements no answer still on its way is older than. */
  function forgetSettledRetirements(): void {
    const oldest = Math.min(...pendingAnswers);
    for (const [pathname, number] of unshared) {
      if (number < oldest) unshared.delete(pathname);
    }
  }

  /**
   * Stores the page's shell and, when its build isn't current yet, makes it
   * current, after a last check that every boot file is still cached. An
   * answer older than the one that made the current build current never
   * switches, and one older than the answer that stopped its page being
   * shared changes nothing. Resolves to whether the build is current.
   */
  function publish(
    record: ShellBuildRecord,
    answer: ShellAnswer,
  ): Promise<boolean> {
    return exclusive(async () => {
      if (removed || unsharedSince(record, answer)) return false;
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
        // After a step-down the build coming back can be the previous one;
        // the build before it stays previous then, so the two never match.
        const before = state.current ?? state.previous;
        const next: ShellState = {
          ...state,
          current: record.version,
          previous: before === record.version ? state.beforePrevious : before,
          beforePrevious: undefined,
        };
        await writeState(next);
        promotedAnswer = answer.number;
        stopOutdatedDownloads(record.version);
        await prune(next);
        stopUnusedFills(await buildsInUse(next));
      }
      return true;
    });
  }

  /**
   * Downloads the rest of the files of the current build and of every build
   * an open tab runs, lazy chunks included, once a page has finished
   * loading. Never under Save-Data; it waits while any build's boot files
   * download, and each page load picks up where the last one stopped.
   */
  async function fillOpenBuilds(): Promise<void> {
    const inUse = await buildsInUse(await readState());
    stopUnusedFills(inUse);
    const running: Promise<void>[] = [];
    for (const version of inUse) {
      if (removed || saveDataNavigation || env.saveData()) break;
      const record = await readBuild(version);
      if (!record || record.assetsCached) continue;
      const stopped = fills.get(version);
      if (stopped?.controller.signal.aborted) {
        // coercion-ok: the stopped fill's own caller reports its failure.
        await stopped.done.catch(() => undefined);
      }
      running.push((fills.get(version) ?? startFill(record)).done);
    }
    await Promise.all(running);
  }

  function startFill({ version, assets }: ShellBuildRecord): Download {
    const controller = new AbortController();
    const download: Download = {
      version,
      answer: promotedAnswer,
      controller,
      done: holding(assets, async () => {
        let complete = false;
        try {
          complete =
            (await precache(assets, {
              skipFailures: true,
              behindBoot: true,
              signal: controller.signal,
            })) === 0;
        } catch (error) {
          // coercion-ok: a stopped fill keeps what it stored while its build
          // is kept; any other failure still reaches the caller.
          if (!controller.signal.aborted) throw error;
        }
        return exclusive(async () => {
          const latest = await readBuild(version);
          if (!latest || removed) return false;
          if (complete) await writeBuild({ ...latest, assetsCached: true });
          return true;
        });
      }).finally(() => {
        if (fills.get(version) === download) fills.delete(version);
      }),
    };
    fills.set(version, download);
    return download;
  }

  /**
   * The server no longer lets anyone share this route's HTML (SSR caching
   * turned off, say): delete its kept shells in every build, so the route
   * goes to the network until the server shares it again. Answers older
   * than this one, still downloading, never bring a shell back.
   */
  async function retirePages(url: URL, number: number): Promise<void> {
    unshared.set(url.pathname, number);
    forgetSettledRetirements();
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
      const next: ShellState = {
        ...state,
        current: undefined,
        previous: state.current,
        beforePrevious: state.previous,
      };
      await writeState(next);
      stopOutdatedDownloads(undefined);
      stopUnusedFills(await buildsInUse(next));
    });
  }

  async function removeWorker(): Promise<void> {
    removed = true;
    for (const download of [...downloads.values(), ...fills.values()]) {
      download.controller.abort();
    }
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

  /**
   * A tab reported the build it runs; that build's files stay while the tab
   * is open. Resolves to whether the worker had a state to record it in.
   */
  async function noteClient(
    clientId: string,
    version: string,
  ): Promise<boolean> {
    if (!clientId || !isShellBuildVersion(version)) return true;
    return exclusive(async () => {
      // A restarted copy of a worker that removed itself must not bring its
      // state back.
      if (removed) return true;
      if (!(await env.caches.has(SHELL_CACHE_NAMES.state))) return false;
      const state = await readState();
      const clients = await openClientBuilds(state.clients);
      clients[clientId] = { version, reportedAt: env.now() };
      await writeState({ ...state, clients });
      return true;
    });
  }

  /** A page finished loading and reported the build it runs. */
  async function pageLoaded(clientId: string, version: string): Promise<void> {
    await noteClient(clientId, version);
    // The rest of the build downloads only once the page's own boot is done.
    await fillOpenBuilds();
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
    const number = (answers += 1);
    if (!isShareableShellResponse(response)) {
      if (isHtmlPage(response)) await retirePages(url, number);
      return;
    }
    pendingAnswers.add(number);
    try {
      await applyAnswer(url, response, fromServer, number);
    } finally {
      pendingAnswers.delete(number);
      forgetSettledRetirements();
    }
  }

  async function applyAnswer(
    url: URL,
    response: Response,
    fromServer: boolean,
    number: number,
  ): Promise<void> {
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
      await downloadBoot(record, number).done;
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
   *
   * Only a page the current build serves a shell for says that build is out
   * of date. The markers don't name the build the page ran (`__an_build`
   * carries the server's deploy id), so a marker on a public page, an
   * unknown path, or with no build current changes nothing.
   */
  async function serveStaleNavigation(
    event: ShellFetchEvent,
    url: URL,
  ): Promise<Response> {
    const page = withoutStaleBuildMarkers(url);
    let state: ShellState = {};
    let served = false;
    try {
      state = await readState();
      const current = await readBuild(state.current);
      served = Boolean(
        current && matchShellRoute(page.pathname, current.routes)?.app,
      );
    } catch (error) {
      // coercion-ok: without the state there's no kept shell to fall back
      // on and no build to step down from; the network still answers.
      reportWorkerError(error);
    }
    if (served) event.waitUntil(stepDown().catch(reportWorkerError));
    try {
      return await networkResponse(event);
    } catch (error) {
      const fallback = await offlineShell(
        [state.current, state.previous],
        page,
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
      isAssetResponse(url.pathname, response) &&
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
      saveDataNavigation =
        request.headers.get("save-data")?.trim().toLowerCase() === "on";
      if (saveDataNavigation) {
        for (const download of fills.values()) download.controller.abort();
      }
      // Framework endpoints and files go to the network, whatever markers
      // their URL carries.
      if (FRAMEWORK_PATH.test(url.pathname) || FILE_PATH.test(url.pathname)) {
        return;
      }
      if (isStaleBuildNavigation(url)) {
        event.respondWith(serveStaleNavigation(event, url));
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

  /**
   * A page the worker didn't serve finished loading: note the build that tab
   * runs, cache the page's shell, then download the rest of the build.
   */
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
    // The tab's build is recorded before any network work, so a deploy found
    // meanwhile can't drop its files.
    const noted = client ? await noteClient(client.id, client.version) : true;
    try {
      await revalidate(url, await fetchFromServer(url), true);
    } finally {
      // On a first visit there was no state to record the tab in yet.
      if (!noted && client) await noteClient(client.id, client.version);
    }
    await fillOpenBuilds();
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
    pageLoaded,
    readState,
    checkWorkerShipped,
  };
}
