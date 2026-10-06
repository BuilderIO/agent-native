import type { ReactElement } from "react";
import ReactDOMServer from "react-dom/server.browser";
import type { EntryContext, RouterContextProvider } from "react-router";

const { renderToReadableStream } = ReactDOMServer;

import { isbot } from "isbot";

import { ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT } from "../shared/route-chunk-recovery-bootstrap.js";
import { wrapWithAnalytics } from "./analytics.js";

export const streamTimeout = 5_000;

const HEAD_OPEN_PATTERN = /<head\b[^>]*>/i;
const CHUNK_RECOVERY_BOOTSTRAP_TAG = `<script data-agent-native-chunk-recovery-bootstrap>${ROUTE_CHUNK_RECOVERY_BOOTSTRAP_SCRIPT}</script>`;

function installEarlyChunkRecoveryBootstrap(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let injected = false;

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });

        if (!injected) {
          const headOpenMatch = HEAD_OPEN_PATTERN.exec(pending);
          if (!headOpenMatch || headOpenMatch.index === undefined) return;

          const headEnd = headOpenMatch.index + headOpenMatch[0].length;
          controller.enqueue(
            encoder.encode(
              pending.slice(0, headEnd) + CHUNK_RECOVERY_BOOTSTRAP_TAG,
            ),
          );
          pending = pending.slice(headEnd);
          injected = true;
        }

        if (pending) {
          controller.enqueue(encoder.encode(pending));
          pending = "";
        }
      },
      flush(controller) {
        pending += decoder.decode();

        if (!injected) {
          const headOpenMatch = HEAD_OPEN_PATTERN.exec(pending);
          if (headOpenMatch && headOpenMatch.index !== undefined) {
            const headEnd = headOpenMatch.index + headOpenMatch[0].length;
            controller.enqueue(
              encoder.encode(
                pending.slice(0, headEnd) + CHUNK_RECOVERY_BOOTSTRAP_TAG,
              ),
            );
            pending = pending.slice(headEnd);
            injected = true;
          }
        }

        if (pending) controller.enqueue(encoder.encode(pending));
      },
    }),
  );
}

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

      responseHeaders.set("Content-Type", "text/html; charset=utf-8");
      return new Response(
        wrapWithAnalytics(installEarlyChunkRecoveryBootstrap(body)),
        {
          headers: responseHeaders,
          status: responseStatusCode,
        },
      );
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
