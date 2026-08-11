import ReactDOMServer from "react-dom/server.browser";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
const { renderToReadableStream } = ReactDOMServer;
import { isbot } from "isbot";

export const streamTimeout = 5_000;

function isDocsRequest(request: Request): boolean {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments[0] === "docs") return true;
  return (
    segments.length > 1 &&
    segments[1] === "docs" &&
    /^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(segments[0])
  );
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const userAgent = request.headers.get("user-agent");
  const waitForAll =
    Boolean(userAgent && isbot(userAgent)) ||
    routerContext.isSpaMode ||
    isDocsRequest(request);

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
    return new Response(body, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
