// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isEmbedChromeRequested } from "./embed-chrome";

function setUrl(href: string): void {
  window.history.replaceState(null, "", href);
}

describe("isEmbedChromeRequested", () => {
  beforeEach(() => {
    setUrl("/");
  });

  afterEach(() => {
    setUrl("/");
  });

  it("is off for an embed that did not ask for chrome", () => {
    setUrl("/visual-edit/d1?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("reads the flag independently for a different embed in the same tab", () => {
    setUrl("/visual-edit/d1?embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    setUrl("/visual-edit/d2?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("clears the flag when the same design returns to a host-owned URL", () => {
    setUrl("/visual-edit/d1?embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    setUrl("/visual-edit/d1?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("stays enabled when the editor preserves the flag while rewriting its URL", () => {
    setUrl("/visual-edit/d1?editorView=overview&embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    setUrl("/design/d1?view=overview&zoom=33&embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);
  });
});
