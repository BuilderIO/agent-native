import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import ReactDOMServer from "react-dom/server.browser";
const { renderToReadableStream } = ReactDOMServer;
import { isbot } from "isbot";
import { wrapWithAnalytics } from "@agent-native/core/server";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  // Reject Chrome DevTools probes that have no matching route
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.well-known/")) {
    return new Response(null, { status: 404 });
  }

  const userAgent = request.headers.get("user-agent");
  const waitForAll = (userAgent && isbot(userAgent)) || routerContext.isSpaMode;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), streamTimeout);

  try {
    const body = await renderToReadableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        signal: abortController.signal,
        onError(error: unknown) {
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
