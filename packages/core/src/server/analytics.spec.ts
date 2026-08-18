import { afterEach, describe, expect, it } from "vitest";

import { injectAnalyticsIntoHtml, wrapWithAnalytics } from "./analytics.js";

const previousGaMeasurementId = process.env.GA_MEASUREMENT_ID;
const previousBakedGaMeasurementId =
  process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID;
const previousGtmContainerId = process.env.GTM_CONTAINER_ID;
const previousBakedGtmContainerId =
  process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID;

afterEach(() => {
  if (previousGaMeasurementId === undefined) {
    delete process.env.GA_MEASUREMENT_ID;
  } else {
    process.env.GA_MEASUREMENT_ID = previousGaMeasurementId;
  }
  if (previousBakedGaMeasurementId === undefined) {
    delete process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID;
  } else {
    process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID =
      previousBakedGaMeasurementId;
  }
  if (previousGtmContainerId === undefined) {
    delete process.env.GTM_CONTAINER_ID;
  } else {
    process.env.GTM_CONTAINER_ID = previousGtmContainerId;
  }
  if (previousBakedGtmContainerId === undefined) {
    delete process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID;
  } else {
    process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID =
      previousBakedGtmContainerId;
  }
});

function streamFromString(value: string): ReadableStream<Uint8Array> {
  return streamFromChunks([value]);
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

describe("wrapWithAnalytics", () => {
  it("passes SSR HTML through when GA is not configured", async () => {
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toBe("<html><head></head><body /></html>");
  });

  it("injects the configured GA measurement id before </head>", async () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    delete process.env.GTM_CONTAINER_ID;

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-UNITTEST123",
    );
    expect(html).toContain(`gtag('config',"G-UNITTEST123")`);
    expect(html.indexOf("googletagmanager.com")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("uses the build-baked GA measurement id when runtime env is absent", async () => {
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;
    process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID = "G-BAKED123";

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-BAKED123",
    );
    expect(html).toContain(`gtag('config',"G-BAKED123")`);
  });

  it("injects GTM at both required document positions", async () => {
    process.env.GTM_CONTAINER_ID = "gtm-unit123";
    process.env.GA_MEASUREMENT_ID = "G-IGNORED123";

    const html = await readStream(
      wrapWithAnalytics(
        streamFromString(
          "<html><head></head><body><main>ok</main></body></html>",
        ),
      ),
    );

    expect(html).toContain("https://www.googletagmanager.com/gtm.js?id='+i+dl");
    expect(html).toContain('"GTM-UNIT123"');
    expect(html).toContain(
      "https://www.googletagmanager.com/ns.html?id=GTM-UNIT123",
    );
    expect(html).not.toContain("gtag('config',\"G-IGNORED123\")");
    expect(html.indexOf("</head>")).toBeLessThan(html.indexOf("<body>"));
    expect(html.indexOf("<body>")).toBeLessThan(html.indexOf("<noscript>"));
  });

  it("handles head and body tags split across SSR chunks", async () => {
    process.env.GTM_CONTAINER_ID = "GTM-CHUNKED123";

    const html = await readStream(
      wrapWithAnalytics(
        streamFromChunks([
          "<html><head><title>App</title></he",
          "ad><bo",
          "dy><main>ok</main></body></html>",
        ]),
      ),
    );

    expect(html.match(/googletagmanager\.com\/gtm\.js/g)).toHaveLength(1);
    expect(html.match(/googletagmanager\.com\/ns\.html/g)).toHaveLength(1);
    expect(html.indexOf("<noscript>")).toBeGreaterThan(html.indexOf("<body>"));
    expect(html).toContain("<main>ok</main>");
  });
});

describe("injectAnalyticsIntoHtml", () => {
  it("injects the configured analytics scripts into auth HTML", () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    delete process.env.GTM_CONTAINER_ID;

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-UNITTEST123",
    );
    expect(html.indexOf("googletagmanager.com")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("injects the GTM noscript fallback into auth HTML", () => {
    process.env.GTM_CONTAINER_ID = "GTM-AUTH123";

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).toContain(
      'src="https://www.googletagmanager.com/ns.html?id=GTM-AUTH123"',
    );
    expect(html.indexOf("<noscript>")).toBeGreaterThan(html.indexOf("<body>"));
  });
});
