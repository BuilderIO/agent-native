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

  it("keeps safe images when Gmail signatures include logos", () => {
    expect(
      htmlSignatureToMarkdown(
        '<div><img src="https://example.com/logo.png" alt="Acme"></div>',
      ),
    ).toBe("![Acme](https://example.com/logo.png)");
  });

  it("drops unsafe URLs", () => {
    expect(
      htmlSignatureToMarkdown(
        '<a href="javascript:alert(1)">Bad</a><img src="data:text/html,hi">',
      ),
    ).toBe("Bad");
  });
});
