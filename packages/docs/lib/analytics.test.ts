import { afterEach, describe, expect, it, vi } from "vitest";

import { wrapDocumentResponse } from "./analytics";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("wrapDocumentResponse", () => {
  it("injects GTM and an isolated GA event loader", async () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-UNITTEST123");
    vi.stubEnv("GTM_CONTAINER_ID", "GTM-UNITTEST123");

    const response = wrapDocumentResponse(
      new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const html = await response.text();

    expect(html).toContain("GTM-UNITTEST123");
    expect(html).toContain(
      "gtag/js?id=G-UNITTEST123&l=__AGENT_NATIVE_GA_DATA_LAYER__",
    );
    expect(html).toContain(
      "agentNativeGtag('config',\"G-UNITTEST123\",{send_page_view:false});",
    );
    expect(response.headers.has("content-length")).toBe(false);
  });

  it("leaves React Router data responses untouched", async () => {
    const response = wrapDocumentResponse(
      new Response('{"data":true}', {
        headers: {
          "content-length": "13",
          "content-type": "application/json",
        },
      }),
    );

    expect(await response.text()).toBe('{"data":true}');
    expect(response.headers.get("content-length")).toBe("13");
  });

  it("accepts an HTML charset parameter", async () => {
    vi.stubEnv("GTM_CONTAINER_ID", "GTM-UNITTEST123");
    const response = wrapDocumentResponse(
      new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    expect(await response.text()).toContain("GTM-UNITTEST123");
  });
});
