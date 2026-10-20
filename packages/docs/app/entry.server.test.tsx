import type { EntryContext, RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import handleRequest from "./entry.server";

const DOCUMENT =
  "<html><head><title>Docs</title></head><body><main></main></body></html>";

vi.mock("react-dom/server.browser", () => ({
  default: {
    renderToReadableStream: async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(DOCUMENT));
          controller.close();
        },
      });
      return Object.assign(stream, { allReady: Promise.resolve() });
    },
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

function render(url: string) {
  return handleRequest(
    new Request(url),
    200,
    new Headers(),
    { isSpaMode: false } as unknown as EntryContext,
    {} as RouterContextProvider,
  );
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("docs document entry", () => {
  it("injects GTM and the isolated GA loader once into marketing pages", async () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-UNITTEST123");
    vi.stubEnv("GTM_CONTAINER_ID", "GTM-UNITTEST123");

    const response = await render("https://www.agent-native.com/");
    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(count(html, "gtm.js?id=")).toBe(1);
    expect(html).toContain('"GTM-UNITTEST123"');
    expect(count(html, "googletagmanager.com/ns.html?id=GTM-UNITTEST123")).toBe(
      1,
    );
    expect(count(html, "gtag/js?id=G-UNITTEST123")).toBe(1);
    expect(html).toContain(
      "agentNativeGtag('config',\"G-UNITTEST123\",{send_page_view:false});",
    );
    expect(html.indexOf("gtm.js?id=")).toBeLessThan(html.indexOf("</head>"));
  });

  it("injects the tags into docs pages", async () => {
    vi.stubEnv("GTM_CONTAINER_ID", "GTM-UNITTEST123");

    const response = await render("https://www.agent-native.com/docs/actions/");

    expect(count(await response.text(), "gtm.js?id=")).toBe(1);
  });
});
