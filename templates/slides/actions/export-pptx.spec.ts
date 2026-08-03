import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: vi.fn(() => "local@example.com"),
}));

vi.mock("../server/db/index.js", () => ({}));

import {
  assertServerPptxExportable,
  fetchImageAsBase64,
  parseSlideHtml,
} from "./export-pptx";

describe("fetchImageAsBase64", () => {
  beforeEach(() => {
    mocks.ssrfSafeFetch.mockReset();
  });

  it("downloads images through the SSRF-safe fetch helper", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      fetchImageAsBase64("https://cdn.example/logo.png"),
    ).resolves.toBe("data:image/png;base64,AQID");
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      "https://cdn.example/logo.png",
      { signal: expect.any(AbortSignal) },
      { maxRedirects: 3 },
    );
  });

  it("rejects non-image responses", async () => {
    mocks.ssrfSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(fetchImageAsBase64("https://cdn.example/page")).resolves.toBe(
      null,
    );
  });

  it("returns null when SSRF-safe fetch blocks a URL", async () => {
    mocks.ssrfSafeFetch.mockRejectedValue(
      new Error("SSRF blocked: refusing to fetch private/internal address"),
    );

    await expect(
      fetchImageAsBase64("http://127.0.0.1/image.png"),
    ).resolves.toBe(null);
  });
});

describe("parseSlideHtml", () => {
  it("allows normal-flow slide HTML", () => {
    expect(() =>
      parseSlideHtml(
        '<div class="fmd-slide"><h1>Title</h1></div>',
        undefined,
        1,
      ),
    ).not.toThrow();
  });

  it("fails loudly instead of reflowing freeform objects", () => {
    expect(() =>
      parseSlideHtml(
        `<div class="fmd-slide">
          <div
            data-slide-object-id="freeform-1"
            style="position: absolute; left: 120px; top: 80px"
          >Text</div>
        </div>`,
        undefined,
        3,
      ),
    ).toThrowError(
      /Slide 3 contains freeform positioned objects.*Export > PowerPoint.*stopped instead of silently reflowing/s,
    );
  });

  it("allows an absolute uploaded background without a persisted object id", () => {
    expect(() =>
      assertServerPptxExportable(
        `<div class="fmd-slide">
          <img
            class="fmd-img-uploaded"
            src="https://cdn.example/background.png"
            style="position: absolute; inset: 0; width: 100%; height: 100%"
          />
          <h1>Title</h1>
        </div>`,
        2,
      ),
    ).not.toThrow();
  });

  it("rejects the persisted freeform class even if its object id is absent", () => {
    expect(() =>
      assertServerPptxExportable(
        `<div class="fmd-slide"><div class="fmd-freeform-object" style="position: absolute">Text</div></div>`,
        4,
      ),
    ).toThrowError(/Slide 4 contains freeform positioned objects/);
  });
});
