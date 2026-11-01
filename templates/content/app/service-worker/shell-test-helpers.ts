// Test doubles for the shell worker specs: Cache Storage held in memory and a
// fetch that answers from a table of URLs.

interface StoredResponse {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: [string, string][];
}

function keyOf(request: Request | string): string {
  return typeof request === "string" ? request : request.url;
}

function revive(stored: StoredResponse): Response {
  return new Response(stored.body.slice(0), {
    status: stored.status,
    statusText: stored.statusText,
    headers: stored.headers,
  });
}

export class MemoryCache {
  readonly entries = new Map<string, StoredResponse>();

  async match(request: Request | string): Promise<Response | undefined> {
    const stored = this.entries.get(keyOf(request));
    return stored ? revive(stored) : undefined;
  }

  async put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(keyOf(request), {
      body: await response.arrayBuffer(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
    });
  }

  async delete(request: Request | string): Promise<boolean> {
    return this.entries.delete(keyOf(request));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  paths(): string[] {
    return [...this.entries.keys()].map((url) => new URL(url).pathname).sort();
  }
}

export class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async match(): Promise<Response | undefined> {
    return undefined;
  }

  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}

export type Route = (init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers from `routes` by URL and records every call. */
export function tableFetch(origin: string, routes: Map<string, Route>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (
    input: Request | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.url, origin);
    const key = `${url.pathname}${url.search}`;
    calls.push({ url: key, init });
    const route = routes.get(key) ?? routes.get(url.pathname);
    if (!route) return new Response("missing", { status: 404 });
    return route(init);
  };
  return { fetch, calls };
}

interface FakeRequestInit {
  mode?: string;
  destination?: string;
  method?: string;
  headers?: Record<string, string>;
  cache?: string;
}

/** Request objects as a worker sees them; real ones can't be built with mode "navigate". */
export function workerRequest(
  url: string,
  init: FakeRequestInit = {},
): Request {
  return {
    url,
    method: init.method ?? "GET",
    mode: init.mode ?? "cors",
    destination: init.destination ?? "",
    cache: init.cache ?? "default",
    headers: new Headers(init.headers),
  } as unknown as Request;
}

export function navigationRequest(url: string): Request {
  return workerRequest(url, { mode: "navigate", destination: "document" });
}

/** A fetch event that records what the worker did with it. */
export function fetchEvent(request: Request) {
  const pending: Promise<unknown>[] = [];
  let responded: Promise<Response> | undefined;
  const event = {
    request,
    respondWith(response: Promise<Response>) {
      responded = response;
    },
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  };
  return {
    event,
    get responded() {
      return responded;
    },
    async settled() {
      // Background work can queue more background work.
      for (let index = 0; index < pending.length; index += 1) {
        await pending[index];
      }
    },
  };
}
