import { describe, expect, it } from "vitest";

import { buildEmailPreviewMarkup } from "./email-preview";

describe("Clips email preview markup", () => {
  it("builds a linked title and thumbnail with a plain-text fallback", () => {
    const preview = buildEmailPreviewMarkup({
      title: "Launch walkthrough",
      shareUrl: "https://clips.example.com/share/rec-1",
      thumbnailUrl: "https://cdn.example.com/preview.gif",
    });

    expect(preview.plainText).toBe(
      "Launch walkthrough\nhttps://clips.example.com/share/rec-1",
    );
    expect(preview.html).toContain(
      'href="https://clips.example.com/share/rec-1"',
    );
    expect(preview.html).toContain('src="https://cdn.example.com/preview.gif"');
    expect(preview.html).toContain(">Launch walkthrough</a>");
  });

  it("escapes title content and rejects non-HTTP URLs", () => {
    const preview = buildEmailPreviewMarkup({
      title: 'A <clip> & "demo"',
      shareUrl: "https://clips.example.com/share/rec-1",
      thumbnailUrl: "https://cdn.example.com/preview.gif",
    });

    expect(preview.html).toContain("A &lt;clip&gt; &amp; &quot;demo&quot;");
    expect(() =>
      buildEmailPreviewMarkup({
        title: "Launch walkthrough",
        shareUrl: "javascript:alert(1)",
        thumbnailUrl: "https://cdn.example.com/preview.gif",
      }),
    ).toThrow("shareUrl must be an absolute HTTP URL");
  });
});
