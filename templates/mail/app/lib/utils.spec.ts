import { describe, expect, it } from "vitest";

import { bodyToHtml, formatShortcut } from "./utils";

describe("bodyToHtml", () => {
  it("matches sent email link rendering for angle-bracket pasted urls", () => {
    const url = "https://calendar.agent-native.com/book/steve/meeting";
    const html = bodyToHtml(`Anything free on my cal work for you? <${url}>`);

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`>${url}</a>`);
    expect(html).not.toContain("&lt;");
    expect(html).not.toContain("&gt;");
  });
});

describe("formatShortcut", () => {
  it("separates shortcut keys with spaces", () => {
    expect(formatShortcut("cmd+shift+enter")).not.toContain("+");
    expect(formatShortcut("cmd+shift+enter")).toContain("Enter");
  });
});
