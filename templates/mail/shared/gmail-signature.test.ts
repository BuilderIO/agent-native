import { describe, expect, it } from "vitest";
import { htmlSignatureToMarkdown } from "./gmail-signature";

describe("htmlSignatureToMarkdown", () => {
  it("keeps text, line breaks, and links from a Gmail signature", () => {
    expect(
      htmlSignatureToMarkdown(
        '<div>Steve</div><div><a href="https://example.com">Website</a></div>',
      ),
    ).toBe("Steve\n\n[Website](https://example.com/)");
  });

  it("drops image assets from Gmail signatures", () => {
    expect(
      htmlSignatureToMarkdown(
        '<div>Steve</div><div><a href="https://example.com"><img src="https://example.com/logo.png" alt="Acme"></a></div>',
      ),
    ).toBe("Steve");
  });

  it("drops unsafe URLs", () => {
    expect(
      htmlSignatureToMarkdown(
        '<a href="javascript:alert(1)">Bad</a><img src="data:text/html,hi">',
      ),
    ).toBe("Bad");
  });
});
