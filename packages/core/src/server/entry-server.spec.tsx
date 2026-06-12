import type { ReactElement } from "react";
import type { AppLoadContext, EntryContext } from "react-router";
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
      {} as AppLoadContext,
    );

    expect(response.status).toBe(207);
    expect(headers.get("content-type")).toBe("text/html");

    const element = mocks.renderToReadableStream.mock.calls[0]?.[0] as
      | ReactElement<{ context: EntryContext; url: string }>
      | undefined;

    expect(element?.type).toBe(AppServerRouter);
    expect(element?.props.context).toBe(routerContext);
    expect(element?.props.url).toBe("https://dispatch.test/overview");
  });
});
