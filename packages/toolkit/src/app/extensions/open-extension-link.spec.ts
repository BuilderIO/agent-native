import { afterEach, describe, expect, it, vi } from "vitest";
import { openExtensionLink, readOpenUrlToken } from "./open-extension-link.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("openExtensionLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens web links in a new tab without an opener", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const url = "https://app.hubspot.com/contacts/1/company/2";

    expect(openExtensionLink({ url, token: TOKEN }, TOKEN)).toBe(true);
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });

  it("refuses requests without the latched token", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const url = "https://example.com/";

    expect(openExtensionLink({ url }, TOKEN)).toBe(false);
    expect(openExtensionLink({ url, token: "other" }, TOKEN)).toBe(false);
    expect(openExtensionLink({ url, token: TOKEN }, null)).toBe(false);
    expect(open).not.toHaveBeenCalled();
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
      expect(openExtensionLink({ url, token: TOKEN }, TOKEN)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("only latches a well-formed token", () => {
    expect(readOpenUrlToken({ openUrlToken: TOKEN })).toBe(TOKEN);
    expect(readOpenUrlToken({ openUrlToken: "short" })).toBeNull();
    expect(readOpenUrlToken({ openUrlToken: 42 })).toBeNull();
    expect(readOpenUrlToken(null)).toBeNull();
  });
});
