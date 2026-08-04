import { describe, expect, it } from "vitest";

import {
  markdownToHtml,
  markdownToText,
  wrapInEmailTemplate,
} from "./email-markdown.js";

describe("email markdown rendering", () => {
  it("renders structured markdown inside a styled email surface", () => {
    const body = markdownToHtml(
      "# Digest\n\n| Name | Status |\n| --- | --- |\n| API | **Ready** |",
    );
    const html = wrapInEmailTemplate(body);

    expect(html).toContain("max-width:640px");
    expect(html).toContain("<h1");
    expect(html).toContain("<table");
    expect(html).toContain("<strong>Ready</strong>");
  });

  it("escapes URL query parameters exactly once", () => {
    const html = markdownToHtml(
      "[Open report](https://app.example.test/d?utm=x&ref=y) https://app.example.test/d?utm=x&ref=y",
    );

    expect(html).toContain('href="https://app.example.test/d?utm=x&amp;ref=y"');
    expect(html).not.toContain("&amp;amp;");
  });

  it("keeps the plain-text alternative readable", () => {
    expect(
      markdownToText("# Digest\n\n- **Ready**: [open](https://example.test)"),
    ).toBe("Digest\nReady: open (https://example.test)");
  });
});
