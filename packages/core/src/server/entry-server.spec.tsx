import { createContext, runInContext } from "node:vm";

import type { ReactElement } from "react";
import type { EntryContext, RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
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

  it("installs a standards-compatible Object.hasOwn before browser modules", async () => {
    mocks.renderToReadableStream.mockImplementationOnce(async () =>
      streamOf(...DOCUMENT_CHUNKS),
    );
    const html = await renderDocument();
    const bootstrap = [
      ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi),
    ].find((match) => match[1].includes("data-agent-native-has-own-bootstrap"));
    expect(bootstrap).toBeDefined();
    if (!bootstrap) throw new Error("Missing Object.hasOwn bootstrap");
    expect(bootstrap.index).toBeLessThan(html.indexOf('rel="modulepreload"'));
    expect(bootstrap.index).toBeLessThan(html.indexOf('type="module"'));
    const bootstrapCode = bootstrap[2];
    const browser = createContext({});
    runInContext("delete Object.hasOwn", browser);
    runInContext(bootstrapCode, browser);

    expect(
      runInContext(
        `(() => {
      const symbol = Symbol("key");
      const object = Object.create({ inherited: true });
      object[symbol] = 1;
      object.hasOwnProperty = null;
      const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn");
      let nullThrows = false;
      let undefinedThrows = false;
      let constructorThrows = false;
      let keyCoerced = false;
      try { Object.hasOwn(null, { toString() { keyCoerced = true; return "x"; } }); } catch (error) { nullThrows = error instanceof TypeError; }
      try { Object.hasOwn(undefined, "x"); } catch (error) { undefinedThrows = error instanceof TypeError; }
      try { new Object.hasOwn({}, "x"); } catch (error) { constructorThrows = error instanceof TypeError; }
      return nullThrows && undefinedThrows && constructorThrows && !keyCoerced &&
        Object.hasOwn(object, symbol) && !Object.hasOwn(object, "inherited") &&
        Object.hasOwn(object, "hasOwnProperty") && Object.hasOwn("abc", 1) &&
        !Object.hasOwn(123, "x") && Object.hasOwn({ x: 1 }, { toString() { return "x"; } }) &&
        descriptor.writable && descriptor.configurable && !descriptor.enumerable &&
        Object.hasOwn.name === "hasOwn" && Object.hasOwn.length === 2;
    })()`,
        browser,
      ),
    ).toBe(true);

    const nativeBrowser = createContext({});
    runInContext("globalThis.originalHasOwn = Object.hasOwn", nativeBrowser);
    runInContext(bootstrapCode, nativeBrowser);
    expect(
      runInContext("Object.hasOwn === originalHasOwn", nativeBrowser),
    ).toBe(true);
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

  describe("document build identity", () => {
    beforeEach(() => {
      vi.stubEnv("AGENT_NATIVE_BUILD_ID", "");
      vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
      resetAppConfigForTests();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      resetAppConfigForTests();
    });

    async function renderWithBuild(env: { id?: string; sha?: string }) {
      if (env.id !== undefined) vi.stubEnv("AGENT_NATIVE_BUILD_ID", env.id);
      if (env.sha !== undefined) vi.stubEnv("AGENT_NATIVE_BUILD_SHA", env.sha);
      resetAppConfigForTests();
      mocks.renderToReadableStream.mockImplementationOnce(async () =>
        streamOf(...DOCUMENT_CHUNKS),
      );
      return renderDocument();
    }

    it("stamps the release into the document's own meta, before the app's head content", async () => {
      const id = "a".repeat(40);
      const html = await renderWithBuild({ id });
      const metaIndex = html.indexOf(
        `<meta name="agent-native-build-sha" content="${id}"/>`,
      );

      expect(metaIndex).toBeGreaterThan(-1);
      expect(metaIndex).toBeLessThan(html.indexOf('rel="modulepreload"'));
      expect(metaIndex).toBeLessThan(html.indexOf('rel="stylesheet"'));
      expect(html).toContain("data-agent-native-build-id");
    });

    it("writes no build marker when the release is unknown", async () => {
      const html = await renderWithBuild({});
      const head = html.slice(0, html.indexOf("</head>"));

      expect(head).not.toContain("agent-native-build-sha");
      expect(head).not.toContain("data-agent-native-build-id");
      expect(head).not.toContain("undefined");
    });

    it("names the workspace commit in the meta while the inline stamp keeps the content build id", async () => {
      const release = "d".repeat(40);
      const artifact = "content-fedcba9876543210fedcba9876543210";
      const html = await renderWithBuild({ id: artifact, sha: release });

      expect(html).toContain(
        `<meta name="agent-native-build-sha" content="${release}"/>`,
      );
      expect(html).toContain(
        `globalThis.__AGENT_NATIVE_BUILD_ID__=${JSON.stringify(artifact)}`,
      );
    });

    it("cannot break out of the meta attribute", async () => {
      const html = await renderWithBuild({ id: 'a"b<c&d' });

      expect(html).toContain(
        '<meta name="agent-native-build-sha" content="a&quot;b&lt;c&amp;d"/>',
      );
    });
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
