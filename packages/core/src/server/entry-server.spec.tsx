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

    const element = mocks.renderToReadableStream.mock.calls[0]?.[0] as
      | ReactElement<{ context: EntryContext; url: string }>
      | undefined;

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
});
