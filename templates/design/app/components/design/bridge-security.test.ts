import { describe, expect, it } from "vitest";

import { isTrustedCanvasBridgeMessage } from "./bridge-security";

describe("isTrustedCanvasBridgeMessage", () => {
  it("accepts same-origin messages from the active preview iframe", () => {
    const iframeWindow = {} as Window;

    expect(
      isTrustedCanvasBridgeMessage({
        source: iframeWindow,
        origin: "http://localhost:8081",
        iframeWindow,
        parentOrigin: "http://localhost:8081",
      }),
    ).toBe(true);
  });

  it("accepts srcdoc null-origin messages from the active preview iframe", () => {
    const iframeWindow = {} as Window;

    expect(
      isTrustedCanvasBridgeMessage({
        source: iframeWindow,
        origin: "null",
        iframeWindow,
        parentOrigin: "http://localhost:8081",
      }),
    ).toBe(true);
  });

  it("rejects messages from other windows or unrelated origins", () => {
    const iframeWindow = {} as Window;
    const otherWindow = {} as Window;

    expect(
      isTrustedCanvasBridgeMessage({
        source: otherWindow,
        origin: "null",
        iframeWindow,
        parentOrigin: "http://localhost:8081",
      }),
    ).toBe(false);

    expect(
      isTrustedCanvasBridgeMessage({
        source: iframeWindow,
        origin: "https://example.com",
        iframeWindow,
        parentOrigin: "http://localhost:8081",
      }),
    ).toBe(false);
  });
});
