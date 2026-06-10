/**
 * Shared React Router entry-server handler for agent-native templates.
 *
 * Templates that don't need customization can reduce their entry.server.tsx
 * to a single re-export:
 *
 *   export { handleDocumentRequest as default, streamTimeout } from "@agent-native/core/server/entry-server";
 *
 * The superset behavior covers all variants observed across the template fleet:
 *   - HEAD requests: return early with status/headers, no stream body
 *   - .well-known rejection: 404 before rendering (avoids Chrome DevTools probe noise)
 *   - streamTimeout + AbortController: abort render after 5 s, preserving
 *     partial output already streamed to the client
 *   - bot/allReady detection: wait for full render for bots and SPA mode so
 *     crawlers receive complete HTML
 *   - wrapWithAnalytics: applied unconditionally — it is a plain import (never
 *     conditionally undefined), so the `typeof === "function"` guards that
 *     appeared in older template copies were dead code and are removed here
 */

import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import ReactDOMServer from "react-dom/server.browser";

const { renderToReadableStream } = ReactDOMServer;

import { isbot } from "isbot";
import { wrapWithAnalytics } from "./analytics.js";

export const streamTimeout = 5_000;

export async function handleDocumentRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
): Promise<Response> {
  // HEAD requests need no body — return immediately.
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  // Reject Chrome DevTools well-known probes that have no matching route.
  // Content template introduced this improvement; it becomes the default here.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }

  const userAgent = request.headers.get("user-agent");
  // Wait for full render for bots (so crawlers see complete HTML) and in SPA
  // mode (where the stream must be fully hydrated before sending).
  const waitForAll = (userAgent && isbot(userAgent)) || routerContext.isSpaMode;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), streamTimeout);

  try {
    const body = await renderToReadableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        signal: abortController.signal,
        onError(error: unknown) {
          // Only record a 500 when the stream hasn't already been deliberately
          // aborted by the timeout above.
          if (!abortController.signal.aborted) {
            responseStatusCode = 500;
            console.error(error);
          }
        },
      },
    );

    if (waitForAll) {
      await body.allReady;
    }

    responseHeaders.set("Content-Type", "text/html");
    return new Response(wrapWithAnalytics(body), {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export default handleDocumentRequest;
