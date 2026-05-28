import { describe, expect, it } from "vitest";

import { isEmbeddedAppMessageSource } from "./react.js";

describe("EmbeddedApp React bridge", () => {
  it("fails closed while the iframe window is unavailable", () => {
    const source = { postMessage() {} } as Window;

    expect(isEmbeddedAppMessageSource({ source }, null)).toBe(false);
    expect(
      isEmbeddedAppMessageSource({ source }, { contentWindow: null }),
    ).toBe(false);
  });

  it("accepts messages only from the embedded iframe window", () => {
    const iframeWindow = { postMessage() {} } as Window;
    const otherWindow = { postMessage() {} } as Window;

    expect(
      isEmbeddedAppMessageSource(
        { source: iframeWindow },
        { contentWindow: iframeWindow },
      ),
    ).toBe(true);
    expect(
      isEmbeddedAppMessageSource(
        { source: otherWindow },
        { contentWindow: iframeWindow },
      ),
    ).toBe(false);
  });
});
