import type { ReactElement } from "react";
import type { EntryContext, RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDocumentRequestHandler } from "./entry-server.js";

const mocks = vi.hoisted(() => {
  const renderToReadableStream = vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html></html>"));
        controller.close();
      },
    }) as ReadableStream<Uint8Array> & { allReady?: Promise<void> };
    stream.allReady = Promise.resolve();
    return stream;
  });

  return { renderToReadableStream };
});

vi.mock("react-dom/server.browser", () => ({
  default: {
    renderToReadableStream: mocks.renderToReadableStream,
  },
}));

vi.mock("isbot", () => ({
  isbot: () => false,
}));

vi.mock("./analytics.js", () => ({
  wrapWithAnalytics: (body: ReadableStream<Uint8Array>) => body,
}));

function renderedElement() {
  return mocks.renderToReadableStream.mock.calls.at(-1)?.[0] as
    | ReactElement<{
        value?: (sessionPath: string) => void;
        children?: ReactElement<{ context: EntryContext; url: string }>;
      }>
    | undefined;
}

function renderedRouter() {
  return renderedElement()?.props.children;
}

function streamOf(...chunks: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  }) as ReadableStream<Uint8Array> & { allReady?: Promise<void> };
  stream.allReady = Promise.resolve();
  return stream;
}

const DOCUMENT_CHUNKS = [
  "<!DOCTYPE html><html><he",
  'ad><link rel="modulepreload" href="/assets/root.js"><link rel="stylesheet" href="/assets/app.css"></head><body><script data-agent-native-session-bootstrap="1"></script><script type="module" src="/assets/entry.js"></script></body></html>',
];

async function renderDocument() {
  const handler = createDocumentRequestHandler(() => null);
  const response = await handler(
    new Request("https://dispatch.test/overview"),
    200,
    new Headers(),
    { isSpaMode: false } as EntryContext,
    {} as RouterContextProvider,
  );
  return response.text();
}

describe("createDocumentRequestHandler", () => {
  beforeEach(() => {
    mocks.renderToReadableStream.mockClear();
  });

  it("renders with the ServerRouter supplied by the app entry", async () => {
    function AppServerRouter() {
      return null;
    }

    const handler = createDocumentRequestHandler(AppServerRouter);
    const routerContext = { isSpaMode: false } as EntryContext;
    const headers = new Headers();

    const response = await handler(
      new Request("https://dispatch.test/overview"),
      207,
      headers,
      routerContext,
      {} as RouterContextProvider,
    );

    expect(response.status).toBe(207);
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");

    const element = renderedRouter();

    expect(element?.type).toBe(AppServerRouter);
    expect(element?.props.context).toBe(routerContext);
    expect(element?.props.url).toBe("https://dispatch.test/overview");
  });

  it("installs chunk recovery before streamed module preload links", async () => {
    mocks.renderToReadableStream.mockImplementationOnce(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("<!DOCTYPE html><html><he"),
          );
          controller.enqueue(
            new TextEncoder().encode(
              'ad><link rel="modulepreload" href="/assets/root.js"></head><body><script type="module" src="/assets/entry.js"></script></body></html>',
            ),
          );
          controller.close();
        },
      }) as ReadableStream<Uint8Array> & { allReady?: Promise<void> };
      stream.allReady = Promise.resolve();
      return stream;
    });

    const handler = createDocumentRequestHandler(() => null);
    const response = await handler(
      new Request("https://dispatch.test/overview"),
      200,
      new Headers(),
      { isSpaMode: false } as EntryContext,
      {} as RouterContextProvider,
    );
    const html = await response.text();

    const bootstrapIndex = html.indexOf(
      "data-agent-native-chunk-recovery-bootstrap",
    );
    const modulePreloadIndex = html.indexOf('rel="modulepreload"');
    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeLessThan(modulePreloadIndex);
    expect(html).toContain("__agentNativeChunkRecovery");
    expect(html).toContain("data-agent-native-route-warmup");
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("starts the session read its render records from the top of <head>", async () => {
    mocks.renderToReadableStream.mockImplementationOnce(async () => {
      renderedElement()?.props.value?.("/_agent-native/auth/session");
      return streamOf(...DOCUMENT_CHUNKS);
    });

    const html = await renderDocument();
    const head = html.slice(0, html.indexOf("</head>"));
    const sessionIndex = head.indexOf(
      'data-agent-native-session-bootstrap="1"',
    );

    expect(sessionIndex).toBeGreaterThan(
      head.indexOf("data-agent-native-chunk-recovery-bootstrap"),
    );
    expect(sessionIndex).toBeLessThan(head.indexOf('rel="modulepreload"'));
    expect(sessionIndex).toBeLessThan(head.indexOf('rel="stylesheet"'));
    expect(head).toContain('fetch("/_agent-native/auth/session"');
  });

  it("starts no session read for a render that records none", async () => {
    mocks.renderToReadableStream.mockImplementationOnce(async () =>
      streamOf(...DOCUMENT_CHUNKS),
    );

    const html = await renderDocument();
    const head = html.slice(0, html.indexOf("</head>"));

    expect(head).toContain("data-agent-native-chunk-recovery-bootstrap");
    expect(head).not.toContain("data-agent-native-session-bootstrap");
  });
});
