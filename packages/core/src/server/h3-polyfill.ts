/**
 * H3 v1/v2 compatibility polyfill.
 *
 * Why this exists:
 * - `@agent-native/core` and templates depend on `h3@^1` for handler types
 *   and helpers (`getMethod`, `readBody`, `getQuery`, `getHeader`, ...).
 * - Nitro 3 internally uses `h3@^2`, which constructs a different `H3Event`
 *   shape: `event.req` is the web Request, `event.url` is a parsed URL,
 *   and `event.node` is undefined on web runtimes (Cloudflare Workers,
 *   Netlify Functions). The v1 helpers all read `event.node.req.*` and
 *   throw `TypeError: Cannot read properties of undefined`.
 *
 * The polyfill mutates a v2 event to look like a v1 event by:
 *   1. Pre-buffering the request body once (web Request bodies can only
 *      be read once) and storing it in `event._requestBody` so v1's
 *      `readRawBody` can find it.
 *   2. Synthesising `event.node = { req, res }` with a Node-like facade
 *      so v1's `getMethod`, `getHeader`, `getRouterParam` work.
 *   3. Setting `event.web = { request: event.req }` as a secondary fallback
 *      that v1's `readRawBody` also checks.
 *
 * Apply this once at the boundary where Nitro hands an event to v1-style
 * handlers — currently `handleFrameworkRequest` for the catch-all and at
 * the top of file-based template route handlers.
 */

const POLYFILL_MARK = Symbol.for("agent-native.h3-polyfilled");

/** Headers iterable that handles both web Headers and plain object form. */
function headersToObject(headers: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function") {
    headers.forEach((value: string, key: string) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (typeof headers === "object") {
    for (const k of Object.keys(headers)) {
      const v = headers[k];
      out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
    }
  }
  return out;
}

/**
 * Polyfill an H3 v2 event so v1 helpers work. Idempotent.
 *
 * IMPORTANT: This is async because it pre-reads the request body. The body
 * is then attached to `event._requestBody` (where v1's `readRawBody` looks
 * first) so subsequent calls to `readBody(event)` work without consuming
 * the body stream a second time.
 */
export async function polyfillH3Event(event: any): Promise<void> {
  if (!event || event[POLYFILL_MARK]) return;

  // If we already have a Node-shaped event (real Node runtime), nothing to do.
  // Mark it so we skip subsequent calls.
  const webReq = event.req;
  const hasNode = !!event.node?.req?.method;

  if (!hasNode && webReq && typeof webReq === "object") {
    // Build a Node-like facade from the web Request.
    const method = String(webReq.method ?? event.method ?? "GET").toUpperCase();
    let pathPlusSearch = "/";
    try {
      const u = new URL(
        webReq.url ?? event.url?.href ?? event.path ?? "/",
        "http://localhost",
      );
      pathPlusSearch = u.pathname + u.search;
    } catch {
      pathPlusSearch = String(webReq.url ?? event.path ?? "/");
    }

    const headers = headersToObject(webReq.headers);

    // Pre-read the body for methods that have one. Web Request bodies can
    // only be consumed once — pre-buffering means we control the lifecycle.
    let bodyBuffer: Uint8Array | undefined;
    if (method !== "GET" && method !== "HEAD") {
      try {
        if (typeof webReq.arrayBuffer === "function") {
          const ab = await webReq.arrayBuffer();
          bodyBuffer = new Uint8Array(ab);
        }
      } catch {
        // Body already consumed elsewhere or unavailable; leave undefined.
      }
    }

    const noop = () => {};
    const nodeFacade = {
      req: {
        method,
        url: pathPlusSearch,
        originalUrl: pathPlusSearch,
        headers,
        socket: { remoteAddress: undefined },
        connection: { encrypted: pathPlusSearch.startsWith("https") },
        on: noop,
        rawBody: bodyBuffer,
        body: bodyBuffer,
      },
      res: {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        setHeader(this: any, k: string, v: string) {
          this._headers[k.toLowerCase()] = v;
        },
        getHeader(this: any, k: string) {
          return this._headers[k.toLowerCase()];
        },
        removeHeader(this: any, k: string) {
          delete this._headers[k.toLowerCase()];
        },
        writeHead: noop,
        write: noop,
        end: noop,
        headersSent: false,
      },
    };

    // Try assignment, fall back to defineProperty if there's a getter.
    try {
      event.node = nodeFacade;
    } catch {
      Object.defineProperty(event, "node", {
        value: nodeFacade,
        writable: true,
        configurable: true,
      });
    }

    // Set event.web for v1's readRawBody fallback path.
    if (!event.web) {
      try {
        event.web = { request: webReq };
      } catch {
        Object.defineProperty(event, "web", {
          value: { request: webReq },
          writable: true,
          configurable: true,
        });
      }
    }

    // Cache the buffered body where v1's readRawBody looks first.
    if (bodyBuffer !== undefined) {
      try {
        event._requestBody = bodyBuffer;
      } catch {
        Object.defineProperty(event, "_requestBody", {
          value: bodyBuffer,
          writable: true,
          configurable: true,
        });
      }
    }
  }

  try {
    event[POLYFILL_MARK] = true;
  } catch {
    Object.defineProperty(event, POLYFILL_MARK, {
      value: true,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Synchronous polyfill that does NOT pre-read the body. Use this when you
 * only need method/url/headers (e.g. for routing decisions) and the handler
 * itself will read the body via web APIs.
 */
export function polyfillH3EventSync(event: any): void {
  if (!event || event[POLYFILL_MARK]) return;
  const webReq = event.req;
  const hasNode = !!event.node?.req?.method;

  if (!hasNode && webReq && typeof webReq === "object") {
    const method = String(webReq.method ?? event.method ?? "GET").toUpperCase();
    let pathPlusSearch = "/";
    try {
      const u = new URL(
        webReq.url ?? event.url?.href ?? event.path ?? "/",
        "http://localhost",
      );
      pathPlusSearch = u.pathname + u.search;
    } catch {
      pathPlusSearch = String(webReq.url ?? event.path ?? "/");
    }
    const headers = headersToObject(webReq.headers);
    const noop = () => {};
    const nodeFacade = {
      req: {
        method,
        url: pathPlusSearch,
        originalUrl: pathPlusSearch,
        headers,
        socket: { remoteAddress: undefined },
        connection: { encrypted: pathPlusSearch.startsWith("https") },
        on: noop,
      },
      res: {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        setHeader(this: any, k: string, v: string) {
          this._headers[k.toLowerCase()] = v;
        },
        getHeader(this: any, k: string) {
          return this._headers[k.toLowerCase()];
        },
        removeHeader(this: any, k: string) {
          delete this._headers[k.toLowerCase()];
        },
        writeHead: noop,
        write: noop,
        end: noop,
        headersSent: false,
      },
    };
    try {
      event.node = nodeFacade;
    } catch {
      Object.defineProperty(event, "node", {
        value: nodeFacade,
        writable: true,
        configurable: true,
      });
    }
    if (!event.web) {
      try {
        event.web = { request: webReq };
      } catch {
        Object.defineProperty(event, "web", {
          value: { request: webReq },
          writable: true,
          configurable: true,
        });
      }
    }
  }
  try {
    event[POLYFILL_MARK] = true;
  } catch {
    Object.defineProperty(event, POLYFILL_MARK, {
      value: true,
      writable: true,
      configurable: true,
    });
  }
}
