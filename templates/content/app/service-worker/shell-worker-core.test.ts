import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { SHELL_CACHE_NAMES, type ShellRoute } from "./shell-contract";
import {
  MemoryCacheStorage,
  fetchEvent,
  navigationRequest,
  tableFetch,
  workerRequest,
  type Route,
} from "./shell-test-helpers";
import { createShellWorker, shellStaticRoutes } from "./shell-worker-core";

const ORIGIN = "https://content.test";
const ROUTES: ShellRoute[] = [
  { id: "routes/_app.page.$id", pattern: "/page/:id", app: true },
  { id: "routes/_app.home", pattern: "/home", app: true },
  { id: "routes/p.$id", pattern: "/p/:id", app: false },
];
const PUBLIC_HTML = "public, max-age=600, stale-while-revalidate=604800";

interface Build {
  version: string;
  boot: string[];
  /** The route module, one of the boot files. */
  page: string;
  lazy: string[];
  html: (marker?: string) => string;
}

/** A build; `shared` adds files another build also boots. */
function makeBuild(letter: string, shared: string[] = []): Build {
  const hash = letter.repeat(8);
  const upper = letter.toUpperCase().repeat(8);
  const page = `/assets/page-${upper}.js`;
  const boot = [
    `/assets/entry.client-${upper}.js`,
    page,
    `/assets/global-${upper}.css`,
    ...shared,
  ];
  return {
    version: hash,
    boot,
    page,
    lazy: [`/assets/lazy-${upper}.js`],
    html: (marker = "") =>
      `<!DOCTYPE html><html><head>` +
      `<link rel="modulepreload" href="/assets/manifest-${hash}.js"/>` +
      boot
        .map((path) => `<link rel="modulepreload" href="${path}"/>`)
        .join("") +
      `</head><body>${marker}<script type="module">import "/assets/manifest-${hash}.js";` +
      `import("/assets/entry.client-${upper}.js");</script></body></html>`,
  };
}

function htmlResponse(html: string, headers: Record<string, string> = {}) {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": PUBLIC_HTML,
      ...headers,
    },
  });
}

function asset(path: string) {
  return new Response(`/* ${path} */`, {
    status: 200,
    headers: { "content-type": "text/javascript" },
  });
}

function hang(): Promise<Response> {
  return new Promise(() => {});
}

function offline(): Promise<Response> {
  return Promise.reject(new TypeError("offline"));
}

/** A promise the spec resolves when it chooses. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

class Server {
  readonly routes = new Map<string, Route>();
  html = "";
  htmlHeaders: Record<string, string> = {};

  constructor() {
    this.routes.set("/sw.js", () => asset("/sw.js"));
  }

  deploy(build: Build) {
    this.html = build.html();
    const files = [
      `/assets/manifest-${build.version}.js`,
      ...build.boot,
      ...build.lazy,
    ];
    for (const path of files) this.routes.set(path, () => asset(path));
    this.routes.set(`/assets/sw-build-${build.version}.json`, () =>
      Response.json({
        version: build.version,
        boot: build.boot,
        assets: files,
        routes: ROUTES,
      }),
    );
    for (const path of ["/page/a", "/page/b", "/page/c", "/home", "/p/x"]) {
      this.routes.set(path, () => htmlResponse(this.html, this.htmlHeaders));
    }
    // The server renders a recovery URL as the page it names.
    this.routes.set("/page/a/__agent-native-chunk-recovery", () =>
      htmlResponse(this.html, { "cache-control": "no-store" }),
    );
  }
}

let storage: MemoryCacheStorage;
let server: Server;
let now: number;
let unregister: Mock<() => Promise<boolean>>;
let fetchCalls: ReturnType<typeof tableFetch>["calls"];
let worker: ReturnType<typeof createShellWorker>;
/** Client ids of the browser's open tabs. */
let openTabs: string[];
let languages: string[];

function startWorker() {
  const table = tableFetch(ORIGIN, server.routes);
  fetchCalls = table.calls;
  worker = createShellWorker({
    origin: ORIGIN,
    caches: storage.asCacheStorage(),
    fetch: table.fetch,
    now: () => now,
    unregister,
    clientIds: async () => openTabs,
    languages: () => languages,
  });
}

async function navigate(path: string) {
  const call = fetchEvent(navigationRequest(`${ORIGIN}${path}`));
  worker.handleFetch(call.event);
  const response = await call.responded;
  return { call, response, text: await response?.text() };
}

async function visitAndSettle(path: string) {
  const visit = await navigate(path);
  await visit.call.settled();
  return visit.text;
}

async function cachePaths(name: string) {
  return (await storage.open(name)).paths();
}

function buildFiles(build: Build) {
  return [`/assets/manifest-${build.version}.js`, ...build.boot, ...build.lazy];
}

beforeEach(() => {
  storage = new MemoryCacheStorage();
  server = new Server();
  now = 1_000_000;
  unregister = vi.fn(async () => true);
  openTabs = [];
  languages = ["en-US", "en"];
  startWorker();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("requests the worker leaves alone", () => {
  it.each([
    [
      "an API call",
      workerRequest(`${ORIGIN}/_agent-native/actions/list-documents`),
    ],
    ["the session read", workerRequest(`${ORIGIN}/_agent-native/auth/session`)],
    [
      "a write",
      workerRequest(`${ORIGIN}/assets/page-AAAAAAAA.js`, { method: "POST" }),
    ],
    [
      "another origin",
      workerRequest("https://cdn.example/assets/x-AAAAAAAA.js"),
    ],
    ["an unhashed file", workerRequest(`${ORIGIN}/favicon.svg`)],
    [
      "a ranged media read",
      workerRequest(`${ORIGIN}/assets/clip-AAAAAAAA.mp4`, {
        headers: { range: "bytes=0-" },
      }),
    ],
    [
      "a frame navigation",
      workerRequest(`${ORIGIN}/page/a`, {
        mode: "navigate",
        destination: "iframe",
      }),
    ],
    [
      "an auth callback",
      navigationRequest(`${ORIGIN}/_agent-native/auth/callback?code=x`),
    ],
    ["the worker script", navigationRequest(`${ORIGIN}/sw.js`)],
  ])("%s goes straight to the network", (_label, request) => {
    const call = fetchEvent(request);
    worker.handleFetch(call.event);
    expect(call.responded).toBeUndefined();
  });
});

describe("app navigations", () => {
  const a = makeBuild("a");

  it("caches the shell and the build's files on the first visit", async () => {
    server.deploy(a);
    const first = await navigate("/page/a");
    expect(first.text).toBe(a.html());
    await first.call.settled();

    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      buildFiles(a).sort(),
    );
    expect(await worker.readState()).toMatchObject({ current: a.version });
  });

  it("answers a reload from the cache without waiting for the network", async () => {
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();

    server.routes.set("/page/a", hang);
    const reload = await navigate("/page/a");
    expect(reload.text).toBe(a.html());
  });

  it("shares one shell across a route's URLs", async () => {
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();
    server.routes.set("/page/b", hang);
    expect((await navigate("/page/b")).text).toBe(a.html());
    expect(await cachePaths(SHELL_CACHE_NAMES.pages)).toHaveLength(1);
  });

  it("keeps a shell per URL once two URLs of a route answer differently", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    server.routes.set("/page/c", () => htmlResponse(a.html("only-c")));
    await visitAndSettle("/page/c");

    // The first URL keeps the copy it shared, so it still opens offline.
    server.routes.set("/page/a", offline);
    server.routes.set("/page/c", offline);
    expect((await navigate("/page/a")).text).toBe(a.html());
    expect((await navigate("/page/c")).text).toBe(a.html("only-c"));
  });

  it("serves the cached shell when the network is gone", async () => {
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();
    server.routes.set("/page/a", () =>
      Promise.reject(new TypeError("offline")),
    );
    const offline = await navigate("/page/a");
    expect(offline.text).toBe(a.html());
    await offline.call.settled();
  });

  it.each([
    ["private", { "cache-control": "private, max-age=0" }],
    ["no-store", { "cache-control": "no-store" }],
    ["varying by cookie", { vary: "Accept-Encoding, Cookie" }],
  ])("never keeps HTML marked %s", async (_label, headers) => {
    server.deploy(a);
    server.htmlHeaders = headers;
    await (await navigate("/page/a")).call.settled();
    expect(await cachePaths(SHELL_CACHE_NAMES.pages)).toEqual([]);
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual([]);
    expect((await worker.readState()).current).toBeUndefined();
  });

  it("never downloads the app for a public page", async () => {
    server.deploy(a);
    await (await navigate("/p/x")).call.settled();
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual([]);
    expect((await worker.readState()).current).toBeUndefined();
  });

  it("leaves a known public route to the network once a build is cached", async () => {
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();
    const before = fetchCalls.length;
    const visit = await navigate("/p/x");
    expect(visit.text).toBe(a.html());
    await visit.call.settled();
    expect(fetchCalls.slice(before).map((call) => call.url)).toEqual(["/p/x"]);
  });
});

describe("deploys", () => {
  const a = makeBuild("a");
  const b = makeBuild("b");
  const c = makeBuild("c");

  it("switches to a new build on the navigation after it is fully cached", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");

    server.deploy(b);
    // The open navigation keeps the build it booted.
    expect(await visitAndSettle("/page/a")).toBe(a.html());
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      expect.arrayContaining([...a.boot, ...b.boot]),
    );

    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(b.html());
  });

  it("doesn't switch back on the old build's HTML from the browser's HTTP cache", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    server.deploy(b);
    await visitAndSettle("/page/a");
    expect((await worker.readState()).current).toBe(b.version);

    // The HTTP cache still holds build a's HTML; only a request that skips
    // it reaches the server.
    server.routes.set("/page/a", (init) =>
      htmlResponse(init?.cache === "no-cache" ? b.html() : a.html()),
    );
    await visitAndSettle("/page/a");
    expect(await worker.readState()).toMatchObject({
      current: b.version,
      previous: a.version,
    });
  });

  it("switches back when the server itself answers with the older build", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    server.deploy(b);
    await visitAndSettle("/page/a");

    // A rollback: the server serves build a again, and its files are kept.
    server.html = a.html();
    await visitAndSettle("/page/a");
    expect(await worker.readState()).toMatchObject({
      current: a.version,
      previous: b.version,
    });
  });

  it("stays on the old build when the browser refuses to store the new one's files", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    const assets = await storage.open(SHELL_CACHE_NAMES.assets);
    const put = assets.put.bind(assets);
    vi.spyOn(assets, "put").mockImplementation(async (request, response) => {
      if (
        String(request instanceof Request ? request.url : request).includes(
          b.version.toUpperCase(),
        )
      ) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return put(request, response);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    server.deploy(b);
    expect(await visitAndSettle("/page/a")).toBe(a.html());
    expect((await worker.readState()).current).toBe(a.version);
    expect(warn).toHaveBeenCalledWith(
      "[content-shell] background update failed",
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    warn.mockRestore();
  });

  it("keeps the old build when one of the new build's files is missing", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");

    server.deploy(b);
    server.routes.delete(b.page);
    expect(await visitAndSettle("/page/a")).toBe(a.html());
    expect((await worker.readState()).current).toBe(a.version);

    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(a.html());
  });

  it("keeps the files of the two newest builds, lazy chunks included", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    server.deploy(b);
    await visitAndSettle("/page/a");
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      expect.arrayContaining([...buildFiles(a), ...buildFiles(b)]),
    );

    // No open tab runs build a, so the next deploy drops it.
    server.deploy(c);
    await visitAndSettle("/page/a");
    const assets = await cachePaths(SHELL_CACHE_NAMES.assets);
    expect(assets).toEqual([...buildFiles(b), ...buildFiles(c)].sort());
    const pages = await cachePaths(SHELL_CACHE_NAMES.pages);
    expect(pages.some((path) => path.includes(a.version))).toBe(false);
  });

  it("keeps an older build's files while an open tab still runs it", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    openTabs = ["tab-on-a"];
    await worker.noteClient("tab-on-a", a.version);

    server.deploy(b);
    await visitAndSettle("/page/a");
    server.deploy(c);
    await visitAndSettle("/page/a");
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      expect.arrayContaining(buildFiles(a)),
    );
    // Only the two newest builds keep shells to answer navigations with.
    const pages = await cachePaths(SHELL_CACHE_NAMES.pages);
    expect(pages.some((path) => path.includes(a.version))).toBe(false);

    // The tab closed, so the next deploy drops the build.
    openTabs = [];
    const d = makeBuild("d");
    server.deploy(d);
    await visitAndSettle("/page/a");
    const assets = await cachePaths(SHELL_CACHE_NAMES.assets);
    expect(assets.some((path) => path.includes("AAAAAAAA"))).toBe(false);
  });

  it("stops keeping a tab's build a day after the tab last reported it", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    openTabs = ["tab-on-a"];
    await worker.noteClient("tab-on-a", a.version);
    server.deploy(b);
    await visitAndSettle("/page/a");

    now += 24 * 60 * 60_000 + 1;
    server.deploy(c);
    await visitAndSettle("/page/a");
    const assets = await cachePaths(SHELL_CACHE_NAMES.assets);
    expect(assets.some((path) => path.includes("AAAAAAAA"))).toBe(false);
  });

  it("re-downloads a kept build's missing files before switching back to it", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    server.deploy(b);
    await visitAndSettle("/page/a");
    // The browser dropped one of build a's files.
    await (
      await storage.open(SHELL_CACHE_NAMES.assets)
    ).delete(`${ORIGIN}${a.page}`);

    server.html = a.html();
    await visitAndSettle("/page/a");
    expect((await worker.readState()).current).toBe(a.version);
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toContain(a.page);
  });

  it.each([
    ["chunk recovery", "/page/a/__agent-native-chunk-recovery"],
    ["the legacy recovery query", "/page/a?__agentNativeChunkRecovery=1"],
    ["the build cache buster", "/page/a?__an_build=abc123"],
  ])(
    "goes to the network after %s until a build is cached again",
    async (_label, path) => {
      server.deploy(a);
      await visitAndSettle("/page/a");

      server.deploy(b);
      const recovery = fetchEvent(navigationRequest(`${ORIGIN}${path}`));
      worker.handleFetch(recovery.event);
      expect(await (await recovery.responded)?.text()).toBe(b.html());
      await recovery.settled();
      expect(await worker.readState()).toMatchObject({
        current: undefined,
        previous: a.version,
      });

      expect(await visitAndSettle("/page/a")).toBe(b.html());
      expect((await worker.readState()).current).toBe(b.version);
    },
  );

  it("falls back to the previous build's shell offline", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    const recovery = fetchEvent(
      navigationRequest(`${ORIGIN}/page/a/__agent-native-chunk-recovery`),
    );
    worker.handleFetch(recovery.event);
    await recovery.settled();

    server.routes.set("/page/a", () =>
      Promise.reject(new TypeError("offline")),
    );
    expect((await navigate("/page/a")).text).toBe(a.html());
  });

  it.each([
    "/page/a/__agent-native-chunk-recovery",
    "/page/a?__agentNativeChunkRecovery=1",
  ])(
    "answers %s offline with the page's kept shell, not the browser's error page",
    async (path) => {
      server.deploy(a);
      await visitAndSettle("/page/a");
      const offline = () => Promise.reject(new TypeError("offline"));
      server.routes.set("/page/a", offline);
      server.routes.set("/page/a/__agent-native-chunk-recovery", offline);

      const recovery = fetchEvent(navigationRequest(`${ORIGIN}${path}`));
      worker.handleFetch(recovery.event);
      expect(await (await recovery.responded)?.text()).toBe(a.html());
      await recovery.settled();
      // A second recovery in the same outage still finds the shell.
      expect((await navigate(path)).text).toBe(a.html());
    },
  );

  it("passes the network error on when no shell of the page is kept", async () => {
    server.routes.set("/page/a/__agent-native-chunk-recovery", () =>
      Promise.reject(new TypeError("offline")),
    );
    const recovery = fetchEvent(
      navigationRequest(`${ORIGIN}/page/a/__agent-native-chunk-recovery`),
    );
    worker.handleFetch(recovery.event);
    await expect(recovery.responded).rejects.toThrow("offline");
  });
});

describe("downloads that overlap", () => {
  const a = makeBuild("a");
  const b = makeBuild("b");
  const c = makeBuild("c");

  async function downloadStarted(path: string) {
    await vi.waitFor(() =>
      expect(fetchCalls.map((call) => call.url)).toContain(path),
    );
  }

  it("never makes a build current after a newer one overtook its download", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");

    server.deploy(b);
    const slow = gate();
    server.routes.set(b.page, async () => {
      await slow.opened;
      return asset(b.page);
    });
    const first = await navigate("/page/a");
    await downloadStarted(b.page);

    // Build c deploys and installs while b's download is still running.
    server.deploy(c);
    await visitAndSettle("/page/a");
    expect((await worker.readState()).current).toBe(c.version);

    slow.open();
    await first.call.settled();
    expect((await worker.readState()).current).toBe(c.version);
    const assets = await cachePaths(SHELL_CACHE_NAMES.assets);
    expect(assets).toEqual(expect.arrayContaining(buildFiles(c)));
    expect(assets.some((path) => path.includes("BBBBBBBB"))).toBe(false);
  });

  it("deletes what failed downloads stored, but not files a kept build shares", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    const kept = await cachePaths(SHELL_CACHE_NAMES.assets);

    // Three deploys in a row, each missing one boot file.
    for (const letter of ["b", "c", "d"]) {
      const broken = makeBuild(letter, [a.page]);
      server.deploy(broken);
      server.routes.delete(broken.page);
      await visitAndSettle("/page/a");
      expect((await worker.readState()).current).toBe(a.version);
    }
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(kept);
  });

  it("waits for the downloads still running when one fails before cleaning up", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    const kept = await cachePaths(SHELL_CACHE_NAMES.assets);

    server.deploy(b);
    server.routes.delete(b.page);
    const css = `/assets/global-BBBBBBBB.css`;
    const slow = gate();
    server.routes.set(css, async () => {
      await slow.opened;
      return asset(css);
    });
    const visit = await navigate("/page/a");
    await downloadStarted(b.page);
    await downloadStarted(css);
    // Long enough for a cleanup that didn't wait to have finished.
    await new Promise((resolve) => setTimeout(resolve, 20));
    slow.open();
    await visit.call.settled();
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(kept);
  });
});

describe("lazy chunks", () => {
  const a = makeBuild("a");
  const b = makeBuild("b");

  it("downloads the rest of the current build behind the page", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    // Chrome answers /assets/* from this cache without running the worker,
    // so a chunk the worker didn't download is never kept.
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      expect.arrayContaining(a.lazy),
    );

    // A tab still on build a can load them after the deploy removed them.
    server.deploy(b);
    for (const path of buildFiles(a)) server.routes.delete(path);
    await visitAndSettle("/page/a");
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual(
      expect.arrayContaining([...buildFiles(a), ...buildFiles(b)]),
    );
  });

  it("picks up the download on a later navigation when it didn't finish", async () => {
    server.deploy(a);
    const [lazy = ""] = a.lazy;
    server.routes.set(lazy, () => new Response("busy", { status: 503 }));
    await visitAndSettle("/page/a");
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).not.toContain(lazy);

    server.routes.set(lazy, () => asset(lazy));
    await visitAndSettle("/page/a");
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toContain(lazy);
  });
});

describe("storage failures", () => {
  const a = makeBuild("a");
  const broken = () => new DOMException("Cache read failed", "UnknownError");

  beforeEach(async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");
    // A fresh worker, as after the browser restarted it.
    startWorker();
  });

  it("loads the page from the network when the cache can't be read", async () => {
    vi.spyOn(storage, "open").mockRejectedValue(broken());
    server.html = a.html("<p>network</p>");
    expect((await navigate("/page/a")).text).toBe(a.html("<p>network</p>"));
  });

  it("reads the cache again after one read failed", async () => {
    vi.spyOn(storage, "open").mockRejectedValueOnce(broken());
    await navigate("/page/a");
    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(a.html());
  });

  it("fetches a file from the network when the cache can't be read", async () => {
    const [lazy = ""] = a.lazy;
    vi.spyOn(storage, "open").mockRejectedValue(broken());
    const load = fetchEvent(workerRequest(`${ORIGIN}${lazy}`));
    worker.handleFetch(load.event);
    expect(await (await load.responded)?.text()).toBe(`/* ${lazy} */`);
  });
});

describe("when the server stops letting a page be shared", () => {
  const a = makeBuild("a");

  it("stops answering from the kept shell, until the server shares it again", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");

    // SSR caching turned off: every page answers no-store. The kept shell
    // answers once more, and the check behind it retires it.
    server.htmlHeaders = { "cache-control": "no-store" };
    server.html = a.html("<p>unshared</p>");
    expect(await visitAndSettle("/page/a")).toBe(a.html());
    expect(await cachePaths(SHELL_CACHE_NAMES.pages)).toEqual([]);
    expect(await visitAndSettle("/page/a")).toBe(a.html("<p>unshared</p>"));

    server.htmlHeaders = {};
    server.html = a.html("<p>shared</p>");
    await visitAndSettle("/page/a");
    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(a.html("<p>shared</p>"));
  });
});

describe("languages", () => {
  const a = makeBuild("a");

  it("keeps a shell per browser language, as the server renders one", async () => {
    server.deploy(a);
    await visitAndSettle("/page/a");

    languages = ["fr-FR", "fr"];
    server.html = a.html("<p>fr</p>");
    expect(await visitAndSettle("/page/a")).toBe(a.html("<p>fr</p>"));

    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(a.html("<p>fr</p>"));
    languages = ["en-US", "en"];
    expect((await navigate("/page/a")).text).toBe(a.html());
  });
});

describe("how long a kept shell answers first", () => {
  const a = makeBuild("a");
  // max-age=600 plus stale-while-revalidate=604800, from PUBLIC_HTML.
  const reuseWindow = (600 + 604_800) * 1000;

  beforeEach(async () => {
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();
    server.html = a.html("<p>fresh</p>");
  });

  it("answers from the kept shell within the server's reuse window", async () => {
    now += reuseWindow;
    expect((await navigate("/page/a")).text).toBe(a.html());
  });

  it("goes to the network first once the kept shell is older than that", async () => {
    now += reuseWindow + 1;
    const visit = await navigate("/page/a");
    expect(visit.text).toBe(a.html("<p>fresh</p>"));
    await visit.call.settled();
    // The network's copy is kept, so the next reload is local again.
    server.routes.set("/page/a", hang);
    expect((await navigate("/page/a")).text).toBe(a.html("<p>fresh</p>"));
  });

  it.each([
    ["the age a CDN reports", { age: "604800" }],
    [
      "the time since the server rendered it",
      { date: new Date(1_000_000 - 604_800_000).toUTCString() },
    ],
  ])("counts %s toward that window", async (_label, headers) => {
    // Stored a week after the server rendered it, so 600 seconds remain.
    server.htmlHeaders = headers;
    await (await navigate("/page/a")).call.settled();
    server.html = a.html("<p>fresher</p>");
    now += 601_000;
    expect((await navigate("/page/a")).text).toBe(a.html("<p>fresher</p>"));
  });

  it("still answers from the old kept shell offline", async () => {
    now += reuseWindow * 4;
    server.routes.set("/page/a", () =>
      Promise.reject(new TypeError("offline")),
    );
    expect((await navigate("/page/a")).text).toBe(a.html());
  });
});

describe("assets", () => {
  const path = "/assets/lazy-AAAAAAAA.js";

  async function load(target = path) {
    const call = fetchEvent(workerRequest(`${ORIGIN}${target}`));
    worker.handleFetch(call.event);
    const response = await call.responded;
    await call.settled();
    return response;
  }

  // A cached build creates the worker's state; these specs start from that point.
  beforeEach(async () => {
    await storage.open(SHELL_CACHE_NAMES.state);
  });

  it("keeps a hashed file it fetched and answers it from the cache next time", async () => {
    server.routes.set(path, () => asset(path));
    expect((await load())?.status).toBe(200);
    server.routes.delete(path);
    expect(await (await load())?.text()).toBe(`/* ${path} */`);
  });

  it("never keeps a failed response", async () => {
    expect((await load())?.status).toBe(404);
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual([]);
  });
});

describe("static routes", () => {
  // The browser applies these without running the worker, so each must give
  // the answer the fetch handler would.
  const routes = shellStaticRoutes();
  const routeFor = (url: string, method = "GET") =>
    routes.find(
      ({ condition }) =>
        new URL(url).pathname.startsWith(condition.urlPattern.slice(0, -1)) &&
        (!condition.requestMethod || condition.requestMethod === method),
    );

  it("reads build files from the cache the worker fills", async () => {
    const a = makeBuild("a");
    server.deploy(a);
    await (await navigate("/page/a")).call.settled();
    const route = routeFor(`${ORIGIN}${a.boot[0]}`);
    expect(route?.source).toEqual({ cacheName: SHELL_CACHE_NAMES.assets });
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toContain(a.boot[0]);
  });

  it("never answers a write from the cache", () => {
    expect(
      routeFor(`${ORIGIN}/assets/page-AAAAAAAA.js`, "POST"),
    ).toBeUndefined();
  });

  it.each([
    `${ORIGIN}/_agent-native/actions/get-document?id=a`,
    `${ORIGIN}/_agent-native/auth/session`,
  ])("sends %s to the network, as the fetch handler does", (url) => {
    expect(routeFor(url)?.source).toBe("network");
    const call = fetchEvent(workerRequest(url));
    worker.handleFetch(call.event);
    expect(call.responded).toBeUndefined();
  });

  it("leaves navigations to the fetch handler", () => {
    for (const path of [
      "/page/a",
      "/home",
      "/page/a/__agent-native-chunk-recovery",
    ]) {
      expect(routeFor(`${ORIGIN}${path}`)).toBeUndefined();
    }
  });
});

describe("removing the worker", () => {
  it("finishes removing itself within the navigation's background work after a deploy without it", async () => {
    server.deploy(makeBuild("a"));
    await (await navigate("/page/a")).call.settled();

    // A rollback to a build from before the worker: no build file, no /sw.js.
    const old = makeBuild("z");
    server.html = old.html();
    server.routes.delete(`/assets/sw-build-${old.version}.json`);
    server.routes.delete("/sw.js");
    now += 2 * 60 * 60_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const visit = await navigate("/page/a");
    expect(unregister).not.toHaveBeenCalled();
    await visit.call.settled();
    warn.mockRestore();

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(await storage.keys()).toEqual([]);
  });

  it("deletes its caches and unregisters when the deploy no longer ships it", async () => {
    server.deploy(makeBuild("a"));
    await (await navigate("/page/a")).call.settled();
    await storage.open("unrelated-cache");

    server.routes.delete("/sw.js");
    now += 2 * 60 * 60_000;
    await worker.checkWorkerShipped();

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(await storage.keys()).toEqual(["unrelated-cache"]);

    // It still controls open tabs, and must leave their requests alone.
    const load = fetchEvent(workerRequest(`${ORIGIN}/assets/lazy-AAAAAAAA.js`));
    worker.handleFetch(load.event);
    expect(load.responded).toBeUndefined();
  });

  it("doesn't bring the file cache back when restarted after removing itself", async () => {
    const path = "/assets/lazy-AAAAAAAA.js";
    server.routes.set(path, () => asset(path));
    const load = fetchEvent(workerRequest(`${ORIGIN}${path}`));
    worker.handleFetch(load.event);
    expect((await load.responded)?.status).toBe(200);
    await load.settled();
    expect(await storage.keys()).toEqual([]);
  });

  it("stores nothing in a file cache the browser brought back empty after it removed itself", async () => {
    const path = "/assets/lazy-AAAAAAAA.js";
    server.routes.set(path, () => asset(path));
    await storage.open(SHELL_CACHE_NAMES.assets);
    const load = fetchEvent(workerRequest(`${ORIGIN}${path}`));
    worker.handleFetch(load.event);
    expect((await load.responded)?.status).toBe(200);
    await load.settled();
    expect(await cachePaths(SHELL_CACHE_NAMES.assets)).toEqual([]);
  });

  it("removes itself when /sw.js answers with the app's HTML instead", async () => {
    server.deploy(makeBuild("a"));
    await (await navigate("/page/a")).call.settled();
    // A host whose catch-all route renders unknown paths.
    server.routes.set("/sw.js", () =>
      htmlResponse("<!DOCTYPE html><p>Page not found</p>"),
    );
    now += 2 * 60 * 60_000;
    await worker.checkWorkerShipped();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("asks at most once an hour and bypasses caches", async () => {
    await worker.checkWorkerShipped();
    await worker.checkWorkerShipped();
    const checks = fetchCalls.filter((call) => call.url.startsWith("/sw.js"));
    expect(checks).toEqual([
      {
        url: expect.stringMatching(/^\/sw\.js\?shell-check=\d+$/),
        init: expect.objectContaining({ cache: "no-store" }),
      },
    ]);
    expect(unregister).not.toHaveBeenCalled();
  });

  it("drops caches left by an older cache layout when it activates", async () => {
    await storage.open("content-shell-v0-assets");
    await storage.open(SHELL_CACHE_NAMES.assets);
    await storage.open("unrelated-cache");
    await worker.activate();
    expect((await storage.keys()).sort()).toEqual(
      [SHELL_CACHE_NAMES.assets, "unrelated-cache"].sort(),
    );
  });
});

describe("adopting the page that registered the worker", () => {
  it("fetches the shell without cookies and caches it", async () => {
    const a = makeBuild("a");
    server.deploy(a);
    await worker.adopt(`${ORIGIN}/home`);
    const htmlCall = fetchCalls.find((call) => call.url === "/home");
    expect(htmlCall?.init).toMatchObject({ credentials: "omit" });
    expect(await worker.readState()).toMatchObject({ current: a.version });

    server.routes.set("/home", hang);
    expect((await navigate("/home")).text).toBe(a.html());
  });

  it("ignores other origins and framework paths", async () => {
    await worker.adopt("https://elsewhere.test/home");
    await worker.adopt(`${ORIGIN}/_agent-native/auth/session`);
    expect(fetchCalls).toEqual([]);
  });
});
