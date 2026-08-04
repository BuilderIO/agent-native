import { afterEach, describe, expect, it } from "vitest";

import { wrapDocumentResponse } from "./analytics";

const previousGaMeasurementId = process.env.GA_MEASUREMENT_ID;
const previousGtmContainerId = process.env.GTM_CONTAINER_ID;

afterEach(() => {
  if (previousGaMeasurementId === undefined) {
    delete process.env.GA_MEASUREMENT_ID;
  } else {
    process.env.GA_MEASUREMENT_ID = previousGaMeasurementId;
  }

  if (previousGtmContainerId === undefined) {
    delete process.env.GTM_CONTAINER_ID;
  } else {
    process.env.GTM_CONTAINER_ID = previousGtmContainerId;
  }
});

describe("wrapDocumentResponse", () => {
  it("injects GTM and does not also inject the standalone GA loader", async () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    process.env.GTM_CONTAINER_ID = "GTM-UNITTEST123";

    const response = wrapDocumentResponse(
      new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const html = await response.text();

    expect(html).toContain("GTM-UNITTEST123");
    expect(html).not.toContain("gtag/js?id=G-UNITTEST123");
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
    process.env.GTM_CONTAINER_ID = "GTM-UNITTEST123";
    const response = wrapDocumentResponse(
      new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    expect(await response.text()).toContain("GTM-UNITTEST123");
  });
});
