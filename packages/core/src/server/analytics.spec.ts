import { afterEach, describe, expect, it } from "vitest";

import { wrapWithAnalytics } from "./analytics.js";

const previousGaMeasurementId = process.env.GA_MEASUREMENT_ID;

afterEach(() => {
  if (previousGaMeasurementId === undefined) {
    delete process.env.GA_MEASUREMENT_ID;
  } else {
    process.env.GA_MEASUREMENT_ID = previousGaMeasurementId;
  }
});

function streamFromString(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
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

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toBe("<html><head></head><body /></html>");
  });

  it("injects the configured GA measurement id before </head>", async () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";

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
});
