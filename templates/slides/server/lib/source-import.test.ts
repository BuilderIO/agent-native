import { describe, expect, it } from "vitest";

import {
  assertSourceSlidePreserved,
  buildSourceImportMetadata,
} from "./source-import.js";

describe("source import preservation", () => {
  const metadata = buildSourceImportMetadata({
    format: "pptx",
    importedAt: "2026-08-06T00:00:00.000Z",
    slides: [
      {
        id: "slide-1",
        text: "Builder teams ship reliable visual systems that help every product group communicate clearly with customers and partners",
        notes: "Speaker notes",
        imageUrls: ["https://files.example/hero.png"],
        editableText: true,
      },
    ],
  });

  it("rejects a replacement that drops the source artwork", () => {
    expect(() =>
      assertSourceSlidePreserved({
        metadata,
        slideId: "slide-1",
        nextContent:
          "<div><h1>New generic card</h1><p>Builder teams ship reliable visual systems</p></div>",
      }),
    ).toThrow("remove 1 original image");
  });

  it("rejects a replacement that drops most source copy", () => {
    expect(() =>
      assertSourceSlidePreserved({
        metadata,
        slideId: "slide-1",
        nextContent:
          '<div><img src="https://files.example/hero.png"><h1>New direction</h1></div>',
      }),
    ).toThrow("drop most of the original factual copy");
  });

  it("allows a bounded source-preserving edit", () => {
    expect(() =>
      assertSourceSlidePreserved({
        metadata,
        slideId: "slide-1",
        nextContent:
          '<div><img src="https://files.example/hero.png"><h1>Builder teams ship reliable visual systems that help every product group communicate clearly with customers and partners</h1></div>',
      }),
    ).not.toThrow();
  });

  it("allows an explicit rewrite opt-out", () => {
    expect(() =>
      assertSourceSlidePreserved({
        metadata,
        slideId: "slide-1",
        nextContent: "<div><h1>New direction</h1></div>",
        preserveSource: false,
      }),
    ).not.toThrow();
  });
});
