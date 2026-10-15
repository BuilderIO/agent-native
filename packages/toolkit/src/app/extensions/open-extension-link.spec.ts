import { afterEach, describe, expect, it, vi } from "vitest";
import { openExtensionLink } from "./open-extension-link.js";

describe("openExtensionLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens web links in a new tab without an opener", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    expect(
      openExtensionLink("https://app.hubspot.com/contacts/1/company/2"),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://app.hubspot.com/contacts/1/company/2",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("refuses anything that isn't an http(s) URL", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/1",
      "/relative/path",
      "",
      42,
      undefined,
    ]) {
      expect(openExtensionLink(url)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });
});
