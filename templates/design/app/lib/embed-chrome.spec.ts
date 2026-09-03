// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetEmbedChromeForTests,
  isEmbedChromeRequested,
} from "./embed-chrome";

function setUrl(href: string): void {
  window.history.replaceState(null, "", href);
}

describe("isEmbedChromeRequested", () => {
  beforeEach(() => {
    _resetEmbedChromeForTests();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    setUrl("/");
  });

  it("is off for an embed that did not ask for chrome", () => {
    setUrl("/visual-edit/d1?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("does not leak the flag to a different embed in the same tab", () => {
    setUrl("/visual-edit/d1?embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    _resetEmbedChromeForTests();
    setUrl("/visual-edit/d2?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("drops the flag on an in-tab navigation to another design", () => {
    setUrl("/visual-edit/d1?embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    // Deliberately no reset: an SPA navigation keeps the module alive.
    setUrl("/visual-edit/d2?editorView=overview");
    expect(isEmbedChromeRequested()).toBe(false);
  });

  it("survives the editor rewriting its own URL", () => {
    setUrl("/visual-edit/d1?editorView=overview&embedChrome=1");
    expect(isEmbedChromeRequested()).toBe(true);

    _resetEmbedChromeForTests();
    setUrl("/design/d1?view=overview&zoom=33");
    expect(isEmbedChromeRequested()).toBe(true);
  });
});
