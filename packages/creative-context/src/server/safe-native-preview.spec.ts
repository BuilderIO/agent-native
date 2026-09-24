import { describe, expect, it } from "vitest";

import { sanitizeSafeNativePreviewHtml } from "./safe-native-preview.js";

describe("safe native preview sanitizer", () => {
  it("removes executable markup, framework handlers, and remote subresources", () => {
    const sanitized = sanitizeSafeNativePreviewHtml(`
      <script>alert(1)</script>
      <iframe src="https://private.example"></iframe>
      <link rel="stylesheet" href="https://private.example/style.css">
      <style>@import "https://private.example/theme.css"; .hero { background: url(https://private.example/a.png) }</style>
      <div onclick="steal()" x-data="{}">
        <img src="https://private.example/image.png" srcset="https://private.example/2x.png 2x">
      </div>
    `);

    expect(sanitized).not.toMatch(
      /script|iframe|private\.example|onclick|srcset|x-data/i,
    );
  });

  it("keeps inert inline image data for self-contained snapshots", () => {
    const sanitized = sanitizeSafeNativePreviewHtml(
      '<img src="data:image/png;base64,AAAA"><a href="#detail">Detail</a>',
    );
    expect(sanitized).toContain("data:image/png;base64,AAAA");
    expect(sanitized).toContain('href="#detail"');
  });
});
