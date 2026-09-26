
import type { ReactElement } from "react";
import ReactDOMServer from "react-dom/server.browser";
import type { EntryContext, RouterContextProvider } from "react-router";

const { renderToReadableStream } = ReactDOMServer;

import { isbot } from "isbot";

import { wrapWithAnalytics } from "./analytics.js";

export const streamTimeout = 5_000;

type ServerRouterComponent = (props: {
  context: EntryContext;
  url: string;
}) => ReactElement;

export type DocumentRequestHandler = (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) => Promise<Response>;

export function createDocumentRequestHandler(
  ServerRouter: ServerRouterComponent,
): DocumentRequestHandler {
  return async function handleDocumentRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext,
    _loadContext: RouterContextProvider,
  ): Promise<Response> {
    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, {
        status: responseStatusCode,
        headers: responseHeaders,
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/.well-known/")) {
      return new Response(null, { status: 404 });
    }

    const userAgent = request.headers.get("user-agent");
    const waitForAll =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode;

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
  };
}

let defaultDocumentRequestHandler: DocumentRequestHandler | null = null;

async function getDefaultDocumentRequestHandler(): Promise<DocumentRequestHandler> {
  if (!defaultDocumentRequestHandler) {
    const { ServerRouter } = await import("react-router");
    defaultDocumentRequestHandler = createDocumentRequestHandler(ServerRouter);
  }
  return defaultDocumentRequestHandler;
}

export async function handleDocumentRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
): Promise<Response> {
  const handler = await getDefaultDocumentRequestHandler();
  return handler(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    loadContext,
  );
}

export default handleDocumentRequest;
